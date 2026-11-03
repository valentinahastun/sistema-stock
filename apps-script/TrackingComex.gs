/**
 * Operaciones Comex · sincronización y mail diario
 *
 * Proyecto de Apps Script independiente (script.google.com > Nuevo proyecto),
 * creado con la cuenta de Valentina, que tiene acceso a las planillas.
 *
 * Qué hace:
 *   - sincronizar(): cada hora lee Seguimiento COMEX ARGREEN (VENTAS,
 *     SEGUIMIENTO OPERATIVO, PAGOS FLETES, COBRANZAS) y PROYECCION CARGAS, y
 *     carga en la base del tracking las operaciones abiertas y los pasos que
 *     ya figuran hechos en las planillas. Nunca pisa lo marcado a mano en la app.
 *   - leerMails(): después de cada sincronización revisa el mail y marca solos
 *     los pasos que se reconocen sin dudas (draft BL enviado, documentos
 *     aprobados, CO y fito originales, BL fechado). Lo dudoso va a "Por confirmar".
 *   - leerCarpetas(): cada hora mira la carpeta de Drive de cada operación
 *     (CV 26-xxx > DOCUS EXPO > Docus Definitivos) y marca los drafts
 *     y los documentos originales que ya están ahí.
 *   - mailDiario(): a las 8 manda a Lourdes y Valentina el resumen de alertas.
 *
 * Instalación: ver README. Propiedades del script necesarias:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, TOKEN_SYNC, APP_URL
 */

const CONFIG = {
  ID_SEGUIMIENTO: '11w6aYtjWvqgjSaFQZOPJOecfmT4JzUvNm2nzxeLj6II',
  ID_PROYECCION: '10nN1M-xV_R4n-uE3fYLg_bQCKGiy4-JoEzWeNTcvs5g',

  // Solo contratos de este año en adelante (prefijo del CV)
  PREFIJOS_CV: ['26-', '27-'],

  // Destinos que no entran: Iguazú, Brasil y terrestres a Chile y Uruguay
  EXCLUIR_DESTINOS: ['iguaz', 'brasil', 'chile', 'santiago', 'longav', 'uruguay', 'montevideo', 'fray bentos', 'argentina'],

  MAIL_DESTINATARIOS: ['valentinahastun@argreen.com.ar', 'lourdesfioretti@argreen.com.ar'],
  HORA_MAIL: 8,

  VEN: { hoja: 'VENTAS', fila: 2, fecha: 'A', cv: 'B', firmado: 'C', producto: 'D', tn: 'G',
         buyer: 'K', importador: 'O', payment: 'V', destino: 'X' },
  SEG: { hoja: 'SEGUIMIENTO OPERATIVO', fila: 2, resp: 'A', cv: 'D', destino: 'E', deposito: 'F', consolidado: 'H',
         carga: 'J', cliente: 'W', fechaOfi: 'AB', booking: 'AH', container: 'AI', tipoBl: 'AK',
         etd: 'AO', eta: 'AP', cobro: 'AX' },
  FLE: { hoja: 'PAGOS FLETES', fila: 9, cv: 'B', estado: 'M' },
  COB: { hoja: 'COBRANZAS', fila: 3, cv: 'B', estado: 'N' },
  // PROYECCION CARGAS: las columnas se buscan por el título de la fila 4 (las dos
  // solapas no tienen exactamente las mismas columnas).
  PRO: { hojas: { 'Cargas Lu': 'lourdes', 'Cargas Vale': 'valentina' }, filaTitulos: 4,
         // Si hay más de un título posible, se toma el primero que tenga dato.
         titulos: { cv: ['cv'], producto: ['mercaderia'], tn: ['tn'], cliente: ['cliente'], destino: ['destino'],
                    booking: ['¿booking?'], etiqueta: ['etiqueta aprobada'], nBooking: ['n° booking'], etd: ['etd'],
                    corte: ['corte documental'], carga: ['fecha carga', 'fecha de carga'],
                    consolidado: ['fecha de consolidado', 'fecha consolidado'],
                    lugar: ['donde se carga'], deposito: ['deposito'] } },
};

// ============================================================
// MENÚ E INSTALACIÓN
// ============================================================
function instalar() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('leerCarpetas').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('mailDiario').timeBased().everyDays(1).atHour(CONFIG.HORA_MAIL).create();
  Logger.log('Listo: sincronización cada 15 minutos, carpetas de Drive cada hora y mail diario a las ' + CONFIG.HORA_MAIL + ' h.');
}

// ============================================================
// SINCRONIZACIÓN
// ============================================================
function sincronizar() {
  const datos = armarDatos(leerTodo());
  const r = rpc('op_sync', { p_token: prop('TOKEN_SYNC'), p_ops: datos.ops, p_hitos: datos.hitos });
  Logger.log('Operaciones: %s · nuevas: %s · pasos actualizados: %s · cerradas: %s',
    datos.ops.length, r.nuevas, r.hitos, r.cerradas);
  // Después de las planillas, el mail (si falla, la sincronización igual quedó hecha)
  try { leerMails(); } catch (e) { Logger.log('No se pudo leer el mail: ' + e.message); }
  return r;
}

function leerTodo() {
  const seg = SpreadsheetApp.openById(CONFIG.ID_SEGUIMIENTO);
  const pro = SpreadsheetApp.openById(CONFIG.ID_PROYECCION);
  const leer = (ss, hoja, fila) => {
    const sh = ss.getSheetByName(hoja);
    if (!sh) throw new Error('No encuentro la solapa "' + hoja + '"');
    const ult = sh.getLastRow();
    return ult >= fila ? sh.getRange(fila, 1, ult - fila + 1, sh.getLastColumn()).getValues() : [];
  };
  const proyeccion = {};
  Object.keys(CONFIG.PRO.hojas).forEach(h => { proyeccion[h] = leer(pro, h, CONFIG.PRO.filaTitulos); });
  return {
    ventas: leer(seg, CONFIG.VEN.hoja, CONFIG.VEN.fila),
    seguimiento: leer(seg, CONFIG.SEG.hoja, CONFIG.SEG.fila),
    fletes: leer(seg, CONFIG.FLE.hoja, CONFIG.FLE.fila),
    cobranzas: leer(seg, CONFIG.COB.hoja, CONFIG.COB.fila),
    proyeccion,
    hoy: new Date(),
  };
}

// Arma operaciones y pasos a partir de las filas leídas (sin tocar Google:
// así se puede probar con las planillas exportadas).
function armarDatos(t) {
  const V = CONFIG.VEN, S = CONFIG.SEG, F = CONFIG.FLE, C = CONFIG.COB, P = CONFIG.PRO;
  const hoy = sinHora(t.hoy);
  const ops = {};
  const hitos = [];
  const op = k => ops[k] || (ops[k] = { clave: k, cv: k.slice(0, 6), lote: k.slice(6) || '' });
  const hito = (clave, paso, fecha, fuente, detalle) => {
    if (fecha instanceof Date && sinHora(fecha) > hoy) return;   // una fecha futura no es un paso hecho
    hitos.push({ clave, paso, fecha: fecha instanceof Date ? iso(fecha) : null, fuente, detalle: detalle || null });
  };

  // --- COBRANZAS: qué está cobrado
  const cobrado = {};
  const enCobranzas = {};
  t.cobranzas.forEach(f => {
    const k = norm(f[col(C.cv)]);
    if (!k) return;
    enCobranzas[k] = true;
    if (/^cobrad/i.test(String(f[col(C.estado)]).trim())) cobrado[k] = true;
  });

  // --- VENTAS: datos del contrato (puede tener varias líneas por CV)
  const ventas = {};
  t.ventas.forEach(f => {
    const k = norm(f[col(V.cv)]);
    if (!k) return;
    const v = ventas[k] || (ventas[k] = { productos: [], tn: 0 });
    if (!v.fecha && esFecha(f[col(V.fecha)])) v.fecha = f[col(V.fecha)];
    if (esSi(f[col(V.firmado)])) v.firmado = true;
    const p = txt(f[col(V.producto)]);
    if (p && v.productos.indexOf(p) < 0) v.productos.push(p);
    if (typeof f[col(V.tn)] === 'number') v.tn += f[col(V.tn)];
    v.buyer = v.buyer || txt(f[col(V.buyer)]);
    v.importador = v.importador || txt(f[col(V.importador)]);
    v.payment = v.payment || txt(f[col(V.payment)]);
    v.destino = v.destino || txt(f[col(V.destino)]);
  });

  // --- SEGUIMIENTO OPERATIVO (una operación ocupa varias filas: los datos van en la primera)
  // Las filas siguientes sin CV son de la misma operación (un contenedor por fila).
  const seg = {};
  const contenedores = {};
  let actual = null;
  t.seguimiento.forEach(f => {
    const crudo = txt(f[col(S.cv)]);
    if (crudo) {
      actual = norm(crudo) || null;
      if (actual && !seg[actual]) seg[actual] = f;
    }
    const c = txt(f[col(S.container)]).toUpperCase();
    if (actual && c) {
      const lista = contenedores[actual] || (contenedores[actual] = []);
      c.split(/[\s,;/]+/).filter(x => x.length >= 6).forEach(x => { if (lista.indexOf(x) < 0) lista.push(x); });
    }
  });

  // --- PROYECCION CARGAS
  const pro = {};
  Object.keys(t.proyeccion).forEach(h => {
    const filas = t.proyeccion[h];
    if (!filas.length) return;
    const titulos = filas[0].map(x => sinAcentos(txt(x)).toLowerCase());
    const pos = {};
    Object.keys(P.titulos).forEach(c => {
      pos[c] = P.titulos[c].map(n => titulos.indexOf(sinAcentos(n).toLowerCase())).filter(i => i >= 0);
    });
    filas.slice(1).forEach(f => {
      const val = c => {
        for (const i of pos[c]) if (f[i] !== '' && f[i] !== null && f[i] !== undefined) return f[i];
        return '';
      };
      const k = norm(val('cv'));
      if (k && !pro[k]) pro[k] = { val, resp: P.hojas[h] };
    });
  });

  // --- Universo: contratos del año no cobrados, o en proyección
  const claves = {};
  Object.keys(enCobranzas).forEach(k => { if (!cobrado[k]) claves[k] = true; });
  Object.keys(pro).forEach(k => { if (!cobrado[k]) claves[k] = true; });

  Object.keys(claves).forEach(k => {
    if (!CONFIG.PREFIJOS_CV.some(p => k.indexOf(p) === 0)) return;
    const v = ventas[k] || ventas[k.slice(0, 6)] || null;
    const s = seg[k] || null;
    const pr = pro[k] ? pro[k].val : null;
    const destino = txt(s && s[col(S.destino)]) || txt(v && v.destino) || txt(pr && pr('destino'));
    if (excluir(destino) || excluir(v && v.destino)) return;

    const o = op(k);
    o.destino = txt(v && v.destino) || destino;
    o.cliente = txt(v && v.importador) || txt(s && s[col(S.cliente)]) || txt(pr && pr('cliente'));
    o.broker = txt(v && v.buyer);
    o.silver = /silver/i.test(o.broker || '');
    o.producto = (v && v.productos.join(', ')) || txt(pr && pr('producto'));
    o.tn = (v && v.tn) || num(pr && pr('tn'));
    o.payment_terms = txt(v && v.payment);
    o.fecha_contrato = isoOrNull(v && v.fecha);
    const r = txt(s && s[col(S.resp)]).toUpperCase();
    o.responsable = r === 'L' ? 'lourdes' : r === 'V' ? 'valentina' : (pro[k] ? pro[k].resp : null);
    o.tipo_bl = txt(s && s[col(S.tipoBl)]);
    o.booking = txt(pr && pr('nBooking')) || txt(s && s[col(S.booking)]);
    o.contenedores = (contenedores[k] || []).join(', ');
    o.fecha_carga_planta = isoOrNull(pr && pr('carga'));
    o.fecha_consolidado = isoOrNull(pr && pr('consolidado'));
    o.corte_documental = isoOrNull(pr && pr('corte'));
    o.lugar_carga = txt(pr && pr('lugar'));
    o.deposito = txt(pr && pr('deposito')) || txt(s && s[col(S.deposito)]);
    o.etd = isoOrNull(pr && pr('etd')) || isoOrNull(s && s[col(S.etd)]);
    o.eta = isoOrNull(s && s[col(S.eta)]);

    // Pasos que ya figuran hechos en las planillas
    if (v && v.firmado) hito(k, 'firma', v.fecha || null, 'ventas');
    if (pr && esSi(pr('etiqueta'))) hito(k, 'etiqueta', null, 'proyeccion');
    if ((pr && (esSi(pr('booking')) || txt(pr('nBooking')))) || (s && txt(s[col(S.booking)])))
      hito(k, 'booking', null, pr ? 'proyeccion' : 'seguimiento', o.booking);
    if (s && esFecha(s[col(S.carga)])) hito(k, 'camiones', s[col(S.carga)], 'seguimiento');
    if (o.contenedores) hito(k, 'retiro', null, 'seguimiento', o.contenedores);
    if (s && esFecha(s[col(S.consolidado)])) hito(k, 'consolidado', s[col(S.consolidado)], 'seguimiento');
    if (s && esFecha(s[col(S.fechaOfi)])) hito(k, 'ddee', s[col(S.fechaOfi)], 'seguimiento', 'Permiso oficializado');
    if (s && esFecha(s[col(S.cobro)])) hito(k, 'cobranza', s[col(S.cobro)], 'seguimiento');
  });

  // --- PAGOS FLETES: flete pagado
  t.fletes.forEach(f => {
    const k = norm(f[col(F.cv)]);
    if (k && ops[k] && /pagad/i.test(String(f[col(F.estado)]))) hito(k, 'flete', null, 'pagos_fletes');
  });

  return { ops: Object.keys(ops).map(k => ops[k]), hitos };
}

// ============================================================
// MAIL DIARIO
// ============================================================
function mailDiario() {
  const alertas = rpc('op_alertas_token', { p_token: prop('TOKEN_SYNC') }).filter(a => a.en_mail);
  const app = prop('APP_URL') || '';
  const fecha = Utilities.formatDate(new Date(), 'America/Argentina/Buenos_Aires', 'dd/MM/yyyy');
  const vencidas = alertas.filter(a => a.nivel === 'vencida');
  const proximas = alertas.filter(a => a.nivel === 'proxima');
  if (!alertas.length) {
    MailApp.sendEmail({ to: CONFIG.MAIL_DESTINATARIOS.join(','), subject: 'Operaciones Comex · ' + fecha + ' · sin alertas',
      htmlBody: '<p>Hoy no hay alertas en las operaciones abiertas.</p>' + (app ? '<p><a href="' + app + '">Abrir Operaciones Comex</a></p>' : '') });
    return;
  }
  const nombre = r => r === 'lourdes' ? 'Lourdes' : r === 'valentina' ? 'Valentina' : 'Sin responsable';
  const tabla = (lista, titulo, color) => !lista.length ? '' :
    '<h3 style="font-family:Arial;color:' + color + ';margin:18px 0 6px">' + titulo + ' (' + lista.length + ')</h3>' +
    '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial;font-size:13px">' +
    '<tr style="background:#eaf7f1"><th align="left">Operación</th><th align="left">Cliente</th><th align="left">Alerta</th><th align="left">Responsable</th></tr>' +
    lista.map(a => '<tr style="border-top:1px solid #ddd"><td>' +
      (app ? '<a href="' + app + '/operaciones/' + encodeURIComponent(a.clave) + '">' : '') +
      'CV ' + a.cv + (a.lote ? ' ' + a.lote : '') + (app ? '</a>' : '') + '</td><td>' + esc(a.cliente || '') +
      '</td><td>' + esc(a.mensaje) + '</td><td>' + nombre(a.responsable) + '</td></tr>').join('') + '</table>';
  MailApp.sendEmail({
    to: CONFIG.MAIL_DESTINATARIOS.join(','),
    subject: 'Operaciones Comex · ' + fecha + ' · ' + vencidas.length + ' para hoy, ' + proximas.length + ' próximas',
    htmlBody: tabla(vencidas, 'Para resolver hoy', '#b42318') + tabla(proximas, 'Vencen en los próximos días', '#9a6700') +
      (app ? '<p style="font-family:Arial;font-size:13px;margin-top:18px"><a href="' + app + '">Abrir Operaciones Comex</a></p>' : ''),
  });
}

// ============================================================
// LECTURA DEL MAIL
// ============================================================
// Reglas (solo las que se pueden reconocer sin dudas). Lo que no se puede asignar
// (sin CV, o CV con varios lotes sin letra) se guarda pero no se pide confirmar.
//   1. Draft BL enviado: Lourdes o Valentina mandan a un cliente o broker (no a un
//      proveedor) un adjunto que se llama "draft ... BL". El CV sale del asunto.
//   2. Draft aprobado: en el hilo "DRAFT - AG nnn" de Reymar, Lourdes o Valentina
//      escriben "aprobado/s" (piden avanzar con originales).
//   3. Certificado de origen y fito: en el hilo "DRAFT - AG nnn", Reymar manda los
//      originales (COD - AG nnn.pdf, fito con número de SENASA nnn-AR-XX-...).
//   4. BL fechado: mail con asunto "BL FINAL FECHADO - CV ...".
//   5. Originales emitidos: Lourdes o Valentina mandan un adjunto "scan cv 26-...".
//   Para el 1 cuenta cualquier draft de documentos al cliente (draft BL, PREFITO,
//   ORIGEN - AG nnn, borrador), no solo el BL.
const MAIL = {
  EQUIPO: ['valentinahastun@argreen.com.ar', 'lourdesfioretti@argreen.com.ar'],
  PROVEEDORES: ['argreen.com.ar', 'reymar', 'cargostaff', 'isbargentina', 'fiscalessanmartin', 'splushipping',
    'americanashipping', 'interborders', 'rucalogistics', 'loginetsa', 'defibe', 'censersa',
    'forwarding.com.ar', 'beyonders', 'biofixagri', 'controlunion', 'glog.com.ar'],
  DIAS_PRIMERA_VEZ: 60,
  APROBACION_CLIENTE: /\b(ok|okay|aprobad[oa]s?|approved?|confirmad[oa]s?|conformes?|all good|looks good|fine)\b/i,
};

function leerMails() {
  const props = PropertiesService.getScriptProperties();
  const ultima = props.getProperty('MAIL_DESDE');
  const desde = ultima ? new Date(ultima) : new Date(Date.now() - MAIL.DIAS_PRIMERA_VEZ * 864e5);
  desde.setDate(desde.getDate() - 1);   // un día de margen; los repetidos se descartan en la base
  const inicio = new Date();
  const despues = 'after:' + Utilities.formatDate(desde, 'America/Argentina/Buenos_Aires', 'yyyy/MM/dd');
  const equipo = '(' + MAIL.EQUIPO.map(e => 'from:' + e).join(' OR ') + ')';

  const busquedas = [
    equipo + ' has:attachment {filename:draft filename:prefito filename:origen filename:scan} ' + despues,
    'subject:"DRAFT - AG" ' + despues,
    'subject:"BL FINAL" ' + despues,
  ];
  const vistos = {};
  const hilos = [];
  busquedas.forEach(q => {
    for (let i = 0; ; i += 100) {
      const lote = GmailApp.search(q, i, 100);
      lote.forEach(h => { if (!vistos[h.getId()]) { vistos[h.getId()] = true; hilos.push(h); } });
      if (lote.length < 100) break;
    }
  });

  const msgs = [];
  hilos.forEach(h => h.getMessages().forEach(m => {
    if (m.getDate() < desde) return;
    const de = direcciones(m.getFrom())[0] || '';
    const texto = textoPropio(m.getPlainBody() || '');
    // Los adjuntos tardan en leerse: solo cuando pueden servir
    const verAdjuntos = MAIL.EQUIPO.indexOf(de) >= 0 || (/reymar/i.test(de) && /original/i.test(texto));
    msgs.push({
      id: m.getId(),
      hilo: h.getId(),
      fecha: m.getDate().toISOString(),
      asunto: m.getSubject() || '',
      hiloAsunto: h.getFirstMessageSubject() || '',
      de,
      para: direcciones(m.getTo() + ',' + m.getCc()),
      texto,
      adjuntos: verAdjuntos ? m.getAttachments({ includeInlineImages: false }).map(a => a.getName()) : [],
      url: 'https://mail.google.com/mail/#search/' + encodeURIComponent('rfc822msgid:' + (m.getHeader('Message-ID') || '').replace(/[<>]/g, '')),
    });
  }));

  const items = analizarMensajes(msgs);
  let r = { nuevos: 0, aplicados: 0, pendientes: 0 };
  for (let i = 0; i < items.length; i += 200) {
    const x = rpc('op_mail', { p_token: prop('TOKEN_SYNC'), p_items: items.slice(i, i + 200) });
    r = { nuevos: r.nuevos + x.nuevos, aplicados: r.aplicados + x.aplicados, pendientes: r.pendientes + x.pendientes };
  }
  props.setProperty('MAIL_DESDE', inicio.toISOString());
  Logger.log('Mails leídos: %s · reconocidos: %s · nuevos: %s · pasos marcados: %s · por confirmar: %s',
    msgs.length, items.length, r.nuevos, r.aplicados, r.pendientes);
  try { fechaBookings(); } catch (e) { Logger.log('No se pudo buscar la fecha de los bookings: ' + e.message); }
  return r;
}

// Fecha real del booking: el primer mail que nombra el número de booking.
// Revisa hasta 15 operaciones por corrida (Gmail es lento); las que ya tienen la
// fecha del mail o cargada a mano no se vuelven a buscar.
function fechaBookings() {
  const lista = rpc('op_bookings_token', { p_token: prop('TOKEN_SYNC') }).slice(0, 15);
  const items = [];
  lista.forEach(o => {
    const numeros = String(o.booking).toUpperCase().split(/[\s,;/]+/).filter(n => /^[A-Z0-9-]{6,}$/.test(n) && /\d{5,}/.test(n));
    if (!numeros.length) return;
    let primero = null;
    numeros.forEach(n => {
      // Primero los hilos con el número en el asunto (la confirmación del forwarder
      // suele tenerlo); si no hay, los 50 más recientes que lo nombran.
      let hilos = GmailApp.search('subject:"' + n + '"', 0, 100);
      if (!hilos.length) hilos = GmailApp.search('"' + n + '"', 0, 50);
      hilos.forEach(h => {
        const m = h.getMessages()[0];
        if (!primero || m.getDate() < primero.getDate()) primero = m;
      });
    });
    if (!primero) return;
    items.push({
      id: 'booking:' + o.clave + ':' + numeros.join('/'), fecha: primero.getDate().toISOString(),
      asunto: primero.getSubject() || '', remitente: direcciones(primero.getFrom())[0] || '',
      url: 'https://mail.google.com/mail/#search/' + encodeURIComponent('rfc822msgid:' + (primero.getHeader('Message-ID') || '').replace(/[<>]/g, '')),
      cv: o.clave.slice(0, 6), lote: o.clave.slice(6), paso: 'booking', seguro: true,
      motivo: 'Primer mail con el booking ' + numeros.join(' / '),
    });
  });
  if (items.length) {
    const x = rpc('op_mail', { p_token: prop('TOKEN_SYNC'), p_items: items });
    Logger.log('Bookings revisados: %s · con fecha del mail: %s', lista.length, x.aplicados);
  }
}

// Para volver a revisar los últimos 60 días desde cero (lo ya registrado no se duplica).
function reiniciarLecturaMails() {
  PropertiesService.getScriptProperties().deleteProperty('MAIL_DESDE');
  return leerMails();
}

// Recibe los mensajes ya leídos (objetos simples, para poder probarlo sin Gmail)
// y devuelve los pasos reconocidos.
function analizarMensajes(msgs) {
  const items = [];
  const add = (m, paso, cv, seguro, motivo) => items.push({
    id: m.id + ':' + paso, fecha: m.fecha, asunto: m.asunto, remitente: m.de, url: m.url,
    cv: cv ? cv.cv : null, lote: cv ? cv.lote : '', cv_alt: cv ? cv.alt || null : null, paso, seguro, motivo,
  });
  const delEquipo = m => MAIL.EQUIPO.indexOf(m.de) >= 0;
  const esProveedor = e => MAIL.PROVEEDORES.some(p => e.split('@')[1] && e.split('@')[1].indexOf(p) >= 0);
  const esCliente = e => e.indexOf('@') > 0 && !esProveedor(e);

  // Por hilo, para buscar la respuesta del cliente después del draft
  const porHilo = {};
  msgs.forEach(m => (porHilo[m.hilo] = porHilo[m.hilo] || []).push(m));
  Object.keys(porHilo).forEach(h => porHilo[h].sort((a, b) => (a.fecha < b.fecha ? -1 : 1)));

  msgs.forEach(m => {
    const asunto = m.hiloAsunto || m.asunto;

    // 2 y 3: hilo de Reymar "DRAFT - AG nnn"
    const ag = cvDeAg(asunto, m.fecha);
    if (ag) {
      if (delEquipo(m) && /aprobad/i.test(sinAcentos(m.texto))) {
        add(m, 'draft_aprobado', ag, true, 'Documentos aprobados (hilo con Reymar)');
      }
      if (/reymar/i.test(m.de) && /original/i.test(m.texto)) {
        if (m.adjuntos.some(a => /^(cod|origen|co)\b/i.test(a))) add(m, 'doc_co', ag, true, 'Reymar mandó el certificado de origen original');
        if (m.adjuntos.some(a => /\d+-AR-[A-Z]{2}-\d+|fito/i.test(a) && !/prefito/i.test(a))) {
          add(m, 'doc_fito', ag, true, 'Reymar mandó el fito original');
        }
      }
      return;
    }

    // 4: BL final fechado
    if (/BL\s+FINAL\s+FECHADO/i.test(m.asunto) && !/^\s*(re|rv|fw|fwd)\s*:/i.test(m.asunto)) {
      const cv = cvDeAsunto(m.asunto);
      add(m, 'doc_bl', cv, !!cv, cv ? 'Mail "BL FINAL FECHADO"' : 'BL final fechado sin CV en el asunto');
      return;
    }

    // 5: scan de los originales
    const scans = delEquipo(m) ? m.adjuntos.filter(a => /scan/i.test(a)) : [];
    if (scans.length) {
      const cv = scans.map(cvDeAsunto).filter(Boolean)[0] || cvDeAsunto(asunto);
      add(m, 'originales', cv, !!cv, cv ? 'Se envió el scan de originales (' + scans[0] + ')'
        : 'Scan enviado sin CV en el nombre ni en el asunto (' + scans[0] + ')');
    }

    // 1: drafts de documentos enviados al cliente
    if (delEquipo(m) && m.adjuntos.some(esAdjuntoDraft) && m.para.some(esCliente)) {
      const cv = cvDeAsunto(asunto);
      const cual = m.adjuntos.filter(esAdjuntoDraft)[0];
      add(m, 'draft_enviado', cv, !!cv, cv ? 'Drafts enviados a ' + m.para.filter(esCliente)[0] + ' (' + cual + ')'
        : 'Drafts enviados a ' + m.para.filter(esCliente)[0] + ' (' + cual + '), sin CV en el asunto');
    }
  });

  // Sin repetidos (el mismo mensaje puede aparecer en dos búsquedas)
  const unicos = {};
  items.forEach(i => { if (!unicos[i.id]) unicos[i.id] = i; });
  return Object.keys(unicos).map(k => unicos[k]);
}

// Drafts de documentos: draft BL, PREFITO, ORIGEN - AG nnn (borrador del CO), "borrador"
function esAdjuntoDraft(nombre) {
  const n = String(nombre).toLowerCase();
  return /draft|prefito|borrador|^origen\s*-\s*ag/.test(n) && !/scan|template/.test(n);
}

function esAdjuntoDraftBl(nombre) {
  const n = String(nombre).toLowerCase();
  return /draft/.test(n) && /(^|[^a-z])b\/?l([^a-z]|$)/.test(n);
}

// "CV 26-116 // MC26668" -> {cv:'26-116', lote:''}; "CV 26-115 A // ..." -> lote 'A'
function cvDeAsunto(s) {
  const t = String(s).toUpperCase();
  const lote = '(?:\\s?([A-Z])(?![A-Z0-9]))?';
  const m = t.match(new RegExp('CV\\s*(2\\d)\\s*-\\s*(\\d{3})' + lote)) ||
            t.match(new RegExp('(?:^|[^0-9])(2\\d)\\s*-\\s*(\\d{3})(?![0-9])' + lote));
  return m ? { cv: m[1] + '-' + m[2], lote: m[3] || '' } : null;
}

// "DRAFT - AG 088B" -> CV 26-088 lote B. El año no figura: se toma el del mail y,
// si no existe esa operación, el anterior (para cargas de enero de contratos del año previo).
function cvDeAg(s, fecha) {
  const m = String(s).toUpperCase().match(/DRAFT\s*-\s*AG\s*(\d{3})\s*([A-Z])?(?![A-Z0-9])/);
  if (!m) return null;
  const anio = new Date(fecha).getFullYear() % 100;
  return { cv: anio + '-' + m[1], lote: m[2] || '', alt: (anio - 1) + '-' + m[1] };
}

// "Lourdes <lourdes@x.com>, b@y.com" -> ['lourdes@x.com', 'b@y.com']
function direcciones(s) {
  return (String(s || '').match(/[A-Za-z0-9._%+'-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || []).map(e => e.toLowerCase().replace(/^'+|'+$/g, ''));
}

// Lo que escribió esa persona, sin el mail citado debajo.
function textoPropio(body) {
  const t = '\n' + String(body).replace(/\r/g, '');
  const cortes = [
    /\n\s*(El|On)\s[^\n]{0,160}(\n[^\n]{0,160}){0,2}?(escribi[óo]|wrote)\s*:/i,
    /\n\s*(De|From)\s*:\s/,
    /\n\s*>/,
    /\n-{3,}\s*(Original|Mensaje)/i,
  ];
  let fin = t.length;
  cortes.forEach(re => { const m = t.match(re); if (m && m.index < fin) fin = m.index; });
  return t.slice(1, fin).trim().slice(0, 2000);
}

// ============================================================
// CARPETAS DE DRIVE
// ============================================================
// Carpeta de la operación ("CV 26-095 120 TN ALUBIA ...") > DOCUS EXPO (drafts)
// > Docus Definitivos / Docus Originales / Documentos Originales (originales).
// Por el nombre de cada archivo de originales se marca el documento:
// Archivo que se llama solo con el número de BL o booking de la naviera
// (MEDUWS173567.pdf, BUA0377068.pdf, COSU6472420940.pdf)
const CODIGO_BL = /^([A-Z]{3,4}[A-Z0-9]*\d{5,}[A-Z0-9]*|\d{5,10})(\s*\(\d+\))?\.pdf$/i;

const DOCS_DRIVE = [
  { re: /quality.*weight|weight.*quality/i, pasos: ['doc_peso'] },
  { re: /fumigation|fumigaci/i, pasos: ['doc_fumigacion'] },
  { re: /documentos\s+originales/i, pasos: ['doc_co', 'doc_fito'] },
  { re: /^cod\b|certificado de origen/i, pasos: ['doc_co'] },
  { re: /\d+-AR-[A-Z]{2}-\d+|^fito/i, pasos: ['doc_fito'] },
  { re: /^pl\b|packing/i, pasos: ['doc_pl'] },
  { re: /^\d{11}_019_/, pasos: ['doc_factura'] },                 // Factura E de Argreen
  { re: /silver\s+invoice/i, pasos: ['doc_factura_silver'] },
  { re: /(^|[^a-z])h?bl([^a-z]|$)|^copy_|bill of lading/i, pasos: ['doc_bl'] },
  { re: CODIGO_BL, pasos: ['doc_bl'] },
];

// Drafts: archivos sueltos en DOCUS EXPO (no en las subcarpetas)
const DRAFTS_DRIVE = [
  { re: /quality.*weight|weight.*quality/i, paso: 'dr_peso' },
  { re: /fumigation|fumigaci/i, paso: 'dr_fumigacion' },
  { re: /^origen\b|origen\s*-\s*ag/i, paso: 'dr_co' },
  { re: /fito/i, paso: 'dr_fito' },
  { re: /(^|[^a-z])h?bl([^a-z]|$)|^copy_|bill of lading|cme\d{5,}/i, paso: 'dr_bl' },
  { re: CODIGO_BL, paso: 'dr_bl' },
  { re: /^pl\b|packing/i, paso: 'dr_pl' },
  { re: /^(?!.*(proforma|silver)).*(^\d{11}_019_|factura|invoice)/i, paso: 'dr_factura' },   // la proforma no cuenta
  { re: /silver\s+invoice/i, paso: 'dr_factura_silver' },
];

// Archivos sueltos en la carpeta de la operación (o del lote)
const RAIZ_DRIVE = [
  { re: /cert-rlu|(^|[^a-z])ip([^a-z0-9]|$)|import\s*permit|sps[\s_-]*ic/i, paso: 'ip' },
  { re: /^bk\b|booking\s*confirm/i, paso: 'booking' },
  { re: /^ofic_/i, paso: 'ddee' },          // DDEE oficializada
  { re: /^cpe-/i, paso: 'camiones' },       // carta de porte electrónica
];

function leerCarpetas() {
  const ops = rpc('op_activas_token', { p_token: prop('TOKEN_SYNC') });
  const porCv = {};
  ops.forEach(o => (porCv[o.cv] = porCv[o.cv] || []).push(o));
  const items = [], carpetas = [];
  const zona = 'America/Argentina/Buenos_Aires';

  Object.keys(porCv).forEach(cv => {
    const reCv = new RegExp('(^|[^0-9])' + cv.replace('-', '\\s*-\\s*') + '(?![0-9])\\s*([A-Z](?:\\s*[-y,/]\\s*[A-Z])*)?(?![A-Za-z])', 'i');
    const it = DriveApp.searchFolders('title contains "' + cv + '" and trashed = false');
    const encontradas = [];
    while (it.hasNext()) {
      const f = it.next();
      const m = f.getName().match(reCv);
      if (!m || /docus|definitiv|original/i.test(f.getName())) continue;
      encontradas.push({ f, lotes: (m[2] || '').toUpperCase().replace(/[^A-Z]/g, '').split('') });
    }
    porCv[cv].forEach(o => {
      const lote = (o.lote || '').toUpperCase();
      // La carpeta de ese lote; si no hay, la que no nombra lotes
      const c = encontradas.find(x => lote && x.lotes.indexOf(lote) >= 0) ||
                encontradas.find(x => !x.lotes.length) || (!lote ? encontradas[0] : null);
      if (!c) return;
      // Si la carpeta tiene una subcarpeta por lote, se usa esa: "B (48 TN)", "Lote B",
      // o por número de embarque/cruce: lote A = "1ER EMBARQUE", E = "5TO EMBARQUE"
      const nro = lote ? lote.charCodeAt(0) - 64 : 0;
      const delLote = lote ? subcarpetas(c.f, new RegExp('^\\s*((lote\\s*)?' + lote + '(?![A-Za-z])|' + nro +
        '\\s*(er|ro|do|to|vo|mo|no|°|º)?\\s*(embarque|cruce|carga|env[ií]o))', 'i'))[0] : null;
      const base = delLote || c.f;
      carpetas.push({ clave: o.clave, url: base.getUrl() });
      // Archivos de la carpeta de la operación (IP, booking)
      [c.f].concat(delLote ? [delLote] : []).forEach(carp => {
        const fs = carp.getFiles();
        while (fs.hasNext()) {
          const a = fs.next();
          const nombre = a.getName();
          const otro = nombre.toUpperCase().match(/(?:AG\s*\d{3}|\d{2}-\d{3})\s?([A-Z])(?![A-Z])/);
          if (otro && lote && otro[1] !== lote) continue;
          RAIZ_DRIVE.forEach(d => {
            if (d.re.test(nombre)) items.push({ clave: o.clave, paso: d.paso, detalle: nombre, url: a.getUrl(),
              fecha: Utilities.formatDate(a.getDateCreated(), zona, 'yyyy-MM-dd') });
          });
        }
      });
      subcarpetas(base, /docus\s*expo/i).forEach(expo => {
        const sueltos = expo.getFiles();
        while (sueltos.hasNext()) {
          const a = sueltos.next();
          const nombre = a.getName();
          const otro = nombre.toUpperCase().match(/(?:AG\s*\d{3}|\d{2}-\d{3})\s?([A-Z])(?![A-Z])/);
          if (otro && lote && otro[1] !== lote) continue;
          DRAFTS_DRIVE.forEach(d => {
            if (d.re.test(nombre)) items.push({ clave: o.clave, paso: d.paso, detalle: nombre, url: a.getUrl(),
              fecha: Utilities.formatDate(a.getDateCreated(), zona, 'yyyy-MM-dd') });
          });
          // El BL a veces se guarda con el número de booking (BUA0377068.pdf)
          if (nombraBooking(nombre, o.booking)) items.push({ clave: o.clave, paso: 'dr_bl', detalle: nombre, url: a.getUrl(),
            fecha: Utilities.formatDate(a.getDateCreated(), zona, 'yyyy-MM-dd') });
        }
        subcarpetas(expo, /definitiv|original/i).forEach(def => {
          const files = def.getFiles();
          while (files.hasNext()) {
            const a = files.next();
            const nombre = a.getName();
            // Si el archivo nombra otro lote (PL ... 26-088 B, AG 088B), no es de esta operación
            const otro = nombre.toUpperCase().match(/(?:AG\s*\d{3}|\d{2}-\d{3})\s?([A-Z])(?![A-Z])/);
            if (otro && lote && otro[1] !== lote) continue;
            const pasos = [];
            DOCS_DRIVE.forEach(d => { if (d.re.test(nombre)) d.pasos.forEach(p => pasos.push(p)); });
            if (nombraBooking(nombre, o.booking)) pasos.push('doc_bl');
            // Si el BL está en Docus Definitivos, también cuenta como el BL de los drafts
            if (pasos.indexOf('doc_bl') >= 0) pasos.push('dr_bl');
            if (pasos.indexOf('doc_factura') >= 0) pasos.push('dr_factura');
            if (pasos.indexOf('doc_factura_silver') >= 0) pasos.push('dr_factura_silver');
            pasos.forEach(paso => items.push({
              clave: o.clave, paso, detalle: nombre, url: a.getUrl(),
              fecha: Utilities.formatDate(a.getDateCreated(), zona, 'yyyy-MM-dd'),
            }));
          }
        });
      });
    });
  });

  const r = rpc('op_drive', { p_token: prop('TOKEN_SYNC'), p_items: items, p_carpetas: carpetas });
  Logger.log('Carpetas encontradas: %s de %s operaciones · documentos vistos: %s · pasos marcados: %s',
    carpetas.length, ops.length, items.length, r.hitos);
  return r;
}

function nombraBooking(nombre, booking) {
  const bk = String(booking || '').toUpperCase().split(/[\s,;/]+/).filter(n => n.length >= 6 && /\d{5,}/.test(n));
  return bk.some(n => String(nombre).toUpperCase().indexOf(n) >= 0);
}

function subcarpetas(padre, re) {
  const out = [];
  const it = padre.getFolders();
  while (it.hasNext()) { const f = it.next(); if (re.test(f.getName())) out.push(f); }
  return out;
}

// ============================================================
// UTILIDADES
// ============================================================
function rpc(fn, body) {
  const url = prop('SUPABASE_URL').replace(/\/$/, '') + '/rest/v1/rpc/' + fn;
  const key = prop('SUPABASE_ANON_KEY');
  const r = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { apikey: key, Authorization: 'Bearer ' + key }, payload: JSON.stringify(body),
  });
  if (r.getResponseCode() >= 300) throw new Error('Supabase ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 300));
  return JSON.parse(r.getContentText());
}

function prop(k) {
  const v = PropertiesService.getScriptProperties().getProperty(k);
  if (!v && k !== 'APP_URL') throw new Error('Falta la propiedad del script ' + k);
  return v;
}

function col(letra) {
  let n = 0;
  for (const ch of letra) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

// "CV 26-088 E" / "26-115 A" / "26-115A" -> "26-088E"
function norm(v) {
  const s = String(v === null || v === undefined ? '' : v).toUpperCase().replace(/^\s*CV/, '').replace(/\s+/g, '');
  const m = s.match(/^(\d{2}-\d{3})([A-Z])?$/);
  return m ? m[1] + (m[2] || '') : '';
}

function excluir(destino) {
  const d = String(destino || '').toLowerCase();
  return d !== '' && CONFIG.EXCLUIR_DESTINOS.some(x => d.indexOf(x) >= 0);
}

function txt(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s === '-' || s === '—' ? '' : s;
}
function num(v) { const n = Number(v); return v === '' || v === null || v === undefined || isNaN(n) ? null : n; }
function esSi(v) {
  const s = String(v || '').trim().toLowerCase();
  return s === 'si' || s === 'sí' || s === 'yes' || /^s[ií][\s(.,]/.test(s);
}
function esFecha(v) { return v instanceof Date && !isNaN(v.getTime()) && v.getFullYear() > 2000; }
function sinHora(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function iso(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function isoOrNull(v) { return esFecha(v) ? iso(v) : null; }
function sinAcentos(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Para pruebas locales con Node
if (typeof module !== 'undefined') module.exports = { armarDatos, norm, CONFIG, analizarMensajes, textoPropio, cvDeAsunto, cvDeAg, esAdjuntoDraftBl, esAdjuntoDraft, direcciones, DOCS_DRIVE, DRAFTS_DRIVE, RAIZ_DRIVE };
