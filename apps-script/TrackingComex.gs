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
    // Columna A de SEGUIMIENTO OPERATIVO: L = Lourdes, V = Valentina (manda sobre todo lo demás)
    const r = sinAcentos(txt(s && s[col(S.resp)])).toUpperCase().charAt(0);
    o.resp_planilla = r === 'L' || r === 'V';
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
  const token = prop('TOKEN_SYNC');
  const alertas = rpc('op_alertas_token', { p_token: token }).filter(a => a.en_mail);
  let agenda = [];
  try { agenda = rpc('op_agenda_token', { p_token: token, p_dias: 1 }); } catch (e) { Logger.log('Sin agenda: ' + e); }
  const m = armarMailDiario(alertas, agenda, prop('APP_URL') || '', new Date());
  MailApp.sendEmail({ to: CONFIG.MAIL_DESTINATARIOS.join(','), subject: m.asunto, htmlBody: m.html });
}

// Qué hay que hacer con cada alerta, en el orden en que conviene resolverlas.
const TAREAS = [
  { paso: 'draft_enviado', titulo: 'Mandar drafts al cliente', icono: '📤' },
  { paso: 'draft_aprobado', titulo: 'Consultar aprobación de drafts', icono: '📄' },
  { paso: 'originales', titulo: 'Reclamar originales', icono: '📦' },
  { paso: 'gmo', titulo: 'Reclamar GMO original', icono: '🧬' },
  { paso: 'etiqueta', titulo: 'Aprobar etiquetas', icono: '🏷️' },
  { paso: 'anticipo', titulo: 'Consultar anticipos', icono: '💵' },
  { paso: 'ip', titulo: 'Pedir IP', icono: '📑' },
  { paso: 'retiro', titulo: 'Revisar calidad (sin Apto)', icono: '🧪' },
  { paso: 'flete', titulo: 'Pedir pago de flete', icono: '🚢' },
  { paso: 'cobranza', titulo: 'Seguir cobranzas', icono: '💰' },
];
const AGENDA = {
  carga: { texto: 'Carga en planta', icono: '🚛' },
  consolidado: { texto: 'Consolidado', icono: '📦' },
  corte: { texto: 'Corte documental', icono: '⏰' },
};

function armarMailDiario(alertas, agenda, app, ahora) {
  const tz = 'America/Argentina/Buenos_Aires';
  const f = (d, p) => Utilities.formatDate(d, tz, p);
  const hoyIso = f(ahora, 'yyyy-MM-dd');
  const dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  const dHoy = new Date(hoyIso + 'T12:00:00Z');
  const fechaLarga = dias[dHoy.getUTCDay()] + ' ' + dHoy.getUTCDate() + ' de ' + meses[dHoy.getUTCMonth()];
  const fechaCorta = f(ahora, 'dd/MM');

  const FONT = 'font-family:Arial,Helvetica,sans-serif;';
  const link = clave => app ? app + '/operaciones/' + encodeURIComponent(clave) : '';
  const op = a => 'CV ' + esc(a.cv) + (a.lote ? ' ' + esc(a.lote) : '');
  const corto = a => {
    if (a.paso === 'retiro') return 'contenedores retirados sin Apto';
    const i = a.mensaje.indexOf(': ');
    return i > 0 && i < 40 ? a.mensaje.slice(i + 2) : a.mensaje;
  };
  const urgentes = alertas.filter(a => a.nivel === 'vencida');
  const proximas = alertas.length - urgentes.length;

  // Tareas agrupadas; primero las que tienen algo vencido
  const agrupar = lista => TAREAS.map((t, orden) => {
    const items = lista.filter(a => a.paso === t.paso)
      .sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'vencida' ? -1 : 1));
    return Object.assign({}, t, { orden, items, urgentes: items.filter(a => a.nivel === 'vencida').length });
  }).filter(g => g.items.length)
    .sort((a, b) => (b.urgentes > 0) - (a.urgentes > 0) || a.orden - b.orden);

  const numero = (n, texto, color) =>
    '<td width="33%" style="padding:4px"><div style="background:#ffffff;border-radius:12px;padding:12px 14px;border:1px solid #eef0f3">' +
    '<div style="' + FONT + 'font-size:26px;font-weight:bold;color:' + color + '">' + n + '</div>' +
    '<div style="' + FONT + 'font-size:12px;color:#64748b">' + texto + '</div></div></td>';

  const fila = (a) => {
    const rojo = a.nivel === 'vencida';
    const url = link(a.clave);
    return '<tr><td style="padding:10px 16px;border-top:1px solid #f1f5f9">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
      '<td width="14" valign="top" style="padding-top:5px"><div style="width:8px;height:8px;border-radius:4px;background:' + (rojo ? '#f43f5e' : '#f59e0b') + '"></div></td>' +
      '<td style="' + FONT + 'font-size:14px;color:#334155">' +
      (url ? '<a href="' + url + '" style="color:#0f172a;font-weight:bold;text-decoration:none">' + op(a) + '</a>' : '<b>' + op(a) + '</b>') +
      ' <span style="color:#475569">· ' + esc(corto(a)) + '</span>' +
      '<div style="font-size:12px;color:#94a3b8;margin-top:2px">' + esc(a.cliente || '') + (a.destino ? ' · ' + esc(a.destino) : '') + '</div></td>' +
      '</tr></table></td></tr>';
  };

  const tarjeta = g =>
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;border:1px solid #eef0f3;margin-bottom:12px">' +
    '<tr><td style="padding:12px 16px;' + FONT + 'font-size:15px;font-weight:bold;color:#0f172a">' +
    g.icono + '&nbsp; ' + g.titulo +
    ' <span style="font-weight:normal;font-size:12px;color:#64748b;background:#f1f5f9;border-radius:10px;padding:2px 8px">' + g.items.length + '</span>' +
    (g.urgentes ? ' <span style="font-weight:normal;font-size:12px;color:#be123c;background:#fff1f2;border-radius:10px;padding:2px 8px">' + g.urgentes + ' para hoy</span>' : '') +
    '</td></tr>' + g.items.map(fila).join('') + '</table>';

  const manana = new Date(dHoy.getTime() + 86400000).toISOString().slice(0, 10);
  const bloqueAgenda = lista => !lista.length ? '' :
    '<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:14px;border:1px solid #eef0f3;margin-bottom:12px">' +
    '<tr><td style="padding:12px 16px;' + FONT + 'font-size:15px;font-weight:bold;color:#0f172a">📅&nbsp; Hoy y mañana</td></tr>' +
    lista.map(e => {
      const t = AGENDA[e.tipo] || { texto: e.tipo, icono: '•' };
      const url = link(e.clave);
      const cuando = e.dia === hoyIso ? 'Hoy' : e.dia === manana ? 'Mañana' : e.dia;
      return '<tr><td style="padding:10px 16px;border-top:1px solid #f1f5f9;' + FONT + 'font-size:14px;color:#334155">' +
        '<span style="display:inline-block;width:62px;font-weight:bold;color:' + (cuando === 'Hoy' ? '#0369a1' : '#64748b') + '">' + cuando + '</span>' +
        t.icono + ' ' + t.texto + ' · ' +
        (url ? '<a href="' + url + '" style="color:#0f172a;font-weight:bold;text-decoration:none">' + op(e) + '</a>' : '<b>' + op(e) + '</b>') +
        '<span style="color:#94a3b8"> · ' + esc(e.cliente || '') + '</span></td></tr>';
    }).join('') + '</table>';

  // Una sección por persona: Lourdes, Valentina y lo que no tiene responsable
  const PERSONAS = [
    { clave: 'lourdes', nombre: 'Lourdes', fondo: '#f1ecff', color: '#6d4bd1' },
    { clave: 'valentina', nombre: 'Valentina', fondo: '#e6f6f4', color: '#0f766e' },
    { clave: '', nombre: 'Sin asignar', fondo: '#f1f5f9', color: '#475569' },
  ];
  const dePersona = (x, p) => p.clave ? x.responsable === p.clave : (x.responsable !== 'lourdes' && x.responsable !== 'valentina');
  const seccion = p => {
    const al = alertas.filter(a => dePersona(a, p));
    const ag = agenda.filter(e => dePersona(e, p));
    if (!al.length && !ag.length) return '';
    const hoyN = al.filter(a => a.nivel === 'vencida').length;
    const resumen = [hoyN ? hoyN + ' para hoy' : '', al.length - hoyN ? (al.length - hoyN) + ' próximas' : '', ag.length ? ag.length + ' en agenda' : '']
      .filter(Boolean).join(' · ');
    return '<div style="margin:26px 0 10px;' + FONT + '">' +
      '<span style="display:inline-block;background:' + p.fondo + ';color:' + p.color + ';font-size:16px;font-weight:bold;border-radius:12px;padding:6px 14px">' + p.nombre + '</span>' +
      '<span style="font-size:13px;color:#64748b;margin-left:10px">' + resumen + '</span></div>' +
      bloqueAgenda(ag) +
      (al.length ? agrupar(al).map(tarjeta).join('') :
        '<div style="' + FONT + 'background:#ffffff;border-radius:14px;border:1px solid #eef0f3;padding:14px 16px;font-size:14px;color:#334155">🎉 Sin pendientes.</div>');
  };

  const boton = !app ? '' :
    '<div style="text-align:center;margin:26px 0 8px"><a href="' + app + '" style="' + FONT +
    'background:#0f766e;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;padding:12px 24px;border-radius:10px;display:inline-block">Abrir Operaciones Comex</a></div>';

  const html =
    '<div style="background:#f6f7f9;padding:20px 10px">' +
    '<div style="max-width:620px;margin:0 auto">' +
    '<div style="' + FONT + 'font-size:22px;font-weight:bold;color:#0f172a">Buen día 👋</div>' +
    '<div style="' + FONT + 'font-size:14px;color:#64748b;margin:2px 0 14px">' + fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1) + '</div>' +
    '<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 -4px 6px"><tr>' +
    numero(urgentes.length, 'para resolver hoy', '#e11d48') +
    numero(proximas, 'vencen en los próximos días', '#d97706') +
    numero(agenda.length, 'cargas, consolidados y cortes hoy y mañana', '#0369a1') +
    '</tr></table>' +
    (alertas.length || agenda.length ? PERSONAS.map(seccion).join('') :
      '<div style="' + FONT + 'background:#ffffff;border-radius:14px;border:1px solid #eef0f3;padding:22px;text-align:center;font-size:15px;color:#334155;margin-top:14px">🎉 No hay pendientes. Todo al día.</div>') +
    boton +
    '</div></div>';

  const asunto = 'Comex ' + fechaCorta + ' · ' +
    (urgentes.length ? urgentes.length + ' para resolver hoy' : 'nada vencido') +
    (proximas ? ', ' + proximas + ' próximas' : '');
  return { asunto, html };
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
//   6. Envío de documentos: mail de Lourdes o Valentina "ENVIO DOCUMENTACIÓN 26-095".
//   Para el 1 cuenta cualquier draft de documentos al cliente (draft BL, PREFITO,
//   ORIGEN - AG nnn, borrador), no solo el BL.
const MAIL = {
  EQUIPO: ['valentinahastun@argreen.com.ar', 'lourdesfioretti@argreen.com.ar'],
  PROVEEDORES: ['argreen.com.ar', 'reymar', 'cargostaff', 'isbargentina', 'fiscalessanmartin', 'splushipping',
    'americanashipping', 'interborders', 'rucalogistics', 'loginetsa', 'defibe', 'censersa',
    'forwarding.com.ar', 'beyonders', 'biofixagri', 'controlunion', 'glog.com.ar'],
  // Forwarders: mandan el draft de BL
  FORWARDERS: ['cargostaff', 'interborders', 'splushipping', 'americanashipping', 'forwarding.com.ar',
    'beyonders', 'glog.com.ar', 'rucalogistics', 'loginetsa', 'transcargo'],
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
    '{' + MAIL.FORWARDERS.map(f => 'from:' + f).join(' ') + '} {draft borrador} ' + despues,
    equipo + ' {subject:envio subject:envío} {subject:documentacion subject:documentación subject:documentos subject:docus} ' + despues,
    equipo + ' subject:apertura subject:cobranza ' + despues,
    '-from:argreen.com.ar {approved aprobados aprobado "proceder con originales" "proceed to the originals" "proceed with the originals"} ' + despues,
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
    const verAdjuntos = MAIL.EQUIPO.indexOf(de) >= 0 || /reymar/i.test(de) ||
      (MAIL.FORWARDERS.some(f => de.indexOf(f) >= 0) && /draft|borrador/i.test(m.getSubject() + ' ' + texto));
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
      if (delEquipo(m) && /aprobad|confirmad|avanzar\s+con\s+(los\s+)?originales/i.test(sinAcentos(m.texto))) {
        add(m, 'draft_aprobado', ag, true, 'Documentos aprobados (hilo con Reymar)');
      }
      // GMO: Reymar manda el borrador (y después el original) del GMO
      if (/reymar/i.test(m.de) && m.adjuntos.some(a => /^ogm\b|(^|[^a-z])gmo([^a-z]|$)/i.test(a))) {
        if (/original/i.test(m.texto)) add(m, 'doc_gmo', ag, true, 'Reymar mandó el GMO original');
        else add(m, 'dr_gmo', ag, true, 'Reymar mandó el borrador del GMO');
      }
      if (/reymar/i.test(m.de) && /original/i.test(m.texto)) {
        if (m.adjuntos.some(a => /^(cod|origen|co)\b/i.test(a))) add(m, 'doc_co', ag, true, 'Reymar mandó el certificado de origen original');
        if (m.adjuntos.some(a => /\d+-AR-[A-Z]{2}-\d+|fito/i.test(a) && !/prefito/i.test(a))) {
          add(m, 'doc_fito', ag, true, 'Reymar mandó el fito original');
        }
      }
      return;
    }

    // 8: el forwarder manda el draft de BL ("DRAFT BL - CV 26-116 ...", o un adjunto "draft ... BL")
    if (MAIL.FORWARDERS.some(f => m.de.indexOf(f) >= 0) &&
        (/draft\s*(de\s*)?b\/?l/i.test(m.asunto) || m.adjuntos.some(esAdjuntoDraftBl))) {
      const cv = cvDeAsunto(m.asunto) || cvDeAsunto(asunto);
      add(m, 'dr_bl', cv, !!cv, cv ? 'El forwarder mandó el draft de BL (' + m.de + ')' : 'Draft de BL sin CV en el asunto');
      return;
    }

    // 6: envío de documentos, primer mail del hilo. Asuntos reales:
    //    "ENVIO DOCUMENTACIÓN 26-095", "ENVIO DOCUMENTOS AG 096", "ENVIO DOCUMENTOS LB 077",
    //    "ENVIO LEGJO DOCUMENTOS CV 26-084", "Envio documentos CV 26-088 "B" y "D""
    if (delEquipo(m) && !/^\s*(re|rv|fw|fwd)\s*:/i.test(m.asunto) &&
        (/envio\s+(de\s+)?(la\s+)?(\w+\s+)?(documentacion|documentos|docus)/i.test(sinAcentos(m.asunto)) ||
         /apertura\s+(de\s+)?cobranza/i.test(sinAcentos(m.asunto)))) {   // cobranza bancaria: los documentos van al banco
      const cvs = cvsDeEnvio(m.asunto, m.fecha);
      if (!cvs.length) add(m, 'envio_docs', null, false, 'Envío de documentos sin CV en el asunto');
      cvs.forEach(cv => add(Object.assign({}, m, { id: m.id + (cv.lote ? '-' + cv.lote : '') }), 'envio_docs', cv, true,
        'Mail "' + m.asunto + '"'));
      return;
    }

    // 7: el cliente o broker aprueba los drafts ("Drafts have been approved",
    //    "Proceder con originales"). El CV sale del asunto del hilo.
    if (esCliente(m.de) && APRUEBA_DRAFTS.test(sinAcentos(m.texto))) {
      const cv = cvDeAsunto(asunto);
      add(m, 'draft_aprobado', cv, !!cv, cv ? 'El cliente aprobó los drafts (' + m.de + ')' : 'Aprobación de drafts sin CV en el asunto');
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
const APRUEBA_DRAFTS = /(drafts?|documents?|documentos|borradores|docs)\b[^.\n]{0,40}\b(approved|aprobad[oa]s?|ok\b|confirmad[oa]s?)|proceder\s+con\s+(los\s+)?originales|proceed\s+(to|with)\s+(the\s+)?originals?|(approve|aprobamos|confirmamos)\s+(the\s+|los\s+)?(drafts?|documents|documentos|borradores)/i;

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

// CV de un mail de envío de documentos: "CV 26-095", "26-095", "AG 096", "LB 077",
// y varios lotes: 'CV 26-088 "B" y "D"' -> 26-088B y 26-088D
function cvsDeEnvio(asunto, fecha) {
  const t = String(asunto).toUpperCase();
  let base = cvDeAsunto(t);
  if (!base) {
    const m = t.match(/(?:AG|LB)\s*(\d{3})\s*([A-Z])?(?![A-Z0-9])/);
    if (m) {
      const anio = new Date(fecha).getFullYear() % 100;
      base = { cv: anio + '-' + m[1], lote: m[2] || '', alt: (anio - 1) + '-' + m[1] };
    }
  }
  if (!base) return [];
  const lotes = (t.match(/"([A-Z])"/g) || []).map(x => x.replace(/"/g, ''));
  return lotes.length ? lotes.map(l => Object.assign({}, base, { lote: l })) : [base];
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
  { re: /^ogm\b|(^|[^a-z])gmo([^a-z]|$)/i, pasos: ['doc_gmo'] },
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
  { re: /^ogm\b|(^|[^a-z])gmo([^a-z]|$)/i, paso: 'dr_gmo' },
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
if (typeof module !== 'undefined') module.exports = { armarMailDiario, armarDatos, norm, CONFIG, analizarMensajes, textoPropio, cvDeAsunto, cvDeAg, esAdjuntoDraftBl, esAdjuntoDraft, direcciones, cvsDeEnvio, APRUEBA_DRAFTS, DOCS_DRIVE, DRAFTS_DRIVE, RAIZ_DRIVE };
