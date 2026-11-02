/**
 * Tracking de operaciones Comex · sincronización y mail diario
 *
 * Proyecto de Apps Script independiente (script.google.com > Nuevo proyecto),
 * creado con la cuenta de Valentina, que tiene acceso a las planillas.
 *
 * Qué hace:
 *   - sincronizar(): cada hora lee Seguimiento COMEX ARGREEN (VENTAS,
 *     SEGUIMIENTO OPERATIVO, PAGOS FLETES, COBRANZAS) y PROYECCION CARGAS, y
 *     carga en la base del tracking las operaciones abiertas y los pasos que
 *     ya figuran hechos en las planillas. Nunca pisa lo marcado a mano en la app.
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
  SEG: { hoja: 'SEGUIMIENTO OPERATIVO', fila: 2, resp: 'A', cv: 'D', destino: 'E', consolidado: 'H',
         carga: 'J', cliente: 'W', fechaOfi: 'AB', booking: 'AH', container: 'AI', tipoBl: 'AK',
         etd: 'AO', eta: 'AP', cobro: 'AX' },
  FLE: { hoja: 'PAGOS FLETES', fila: 9, cv: 'B', estado: 'M' },
  COB: { hoja: 'COBRANZAS', fila: 3, cv: 'B', estado: 'N' },
  PRO: { hojas: { 'Cargas Lu': 'lourdes', 'Cargas Vale': 'valentina' }, fila: 5, cv: 'A', producto: 'B',
         tn: 'C', cliente: 'E', destino: 'F', booking: 'G', etiqueta: 'H', nBooking: 'I', etd: 'M',
         corte: 'O', carga: 'R', consolidado: 'S' },
};

// ============================================================
// MENÚ E INSTALACIÓN
// ============================================================
function instalar() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(1).create();
  ScriptApp.newTrigger('mailDiario').timeBased().everyDays(1).atHour(CONFIG.HORA_MAIL).create();
  Logger.log('Listo: sincronización cada hora y mail diario a las ' + CONFIG.HORA_MAIL + ' h.');
}

// ============================================================
// SINCRONIZACIÓN
// ============================================================
function sincronizar() {
  const datos = armarDatos(leerTodo());
  const r = rpc('op_sync', { p_token: prop('TOKEN_SYNC'), p_ops: datos.ops, p_hitos: datos.hitos });
  Logger.log('Operaciones: %s · nuevas: %s · pasos actualizados: %s · cerradas: %s',
    datos.ops.length, r.nuevas, r.hitos, r.cerradas);
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
  Object.keys(CONFIG.PRO.hojas).forEach(h => { proyeccion[h] = leer(pro, h, CONFIG.PRO.fila); });
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
  const seg = {};
  t.seguimiento.forEach(f => {
    const k = norm(f[col(S.cv)]);
    if (k && !seg[k]) seg[k] = f;
  });

  // --- PROYECCION CARGAS
  const pro = {};
  Object.keys(t.proyeccion).forEach(h => {
    t.proyeccion[h].forEach(f => {
      const k = norm(f[col(P.cv)]);
      if (k && !pro[k]) pro[k] = { f, resp: P.hojas[h] };
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
    const pr = pro[k] ? pro[k].f : null;
    const destino = txt(s && s[col(S.destino)]) || txt(v && v.destino) || txt(pr && pr[col(P.destino)]);
    if (excluir(destino) || excluir(v && v.destino)) return;

    const o = op(k);
    o.destino = txt(v && v.destino) || destino;
    o.cliente = txt(v && v.importador) || txt(s && s[col(S.cliente)]) || txt(pr && pr[col(P.cliente)]);
    o.broker = txt(v && v.buyer);
    o.silver = /silver/i.test(o.broker || '');
    o.producto = (v && v.productos.join(', ')) || txt(pr && pr[col(P.producto)]);
    o.tn = (v && v.tn) || num(pr && pr[col(P.tn)]);
    o.payment_terms = txt(v && v.payment);
    o.fecha_contrato = isoOrNull(v && v.fecha);
    const r = txt(s && s[col(S.resp)]).toUpperCase();
    o.responsable = r === 'L' ? 'lourdes' : r === 'V' ? 'valentina' : (pro[k] ? pro[k].resp : null);
    o.tipo_bl = txt(s && s[col(S.tipoBl)]);
    o.booking = txt(pr && pr[col(P.nBooking)]) || txt(s && s[col(S.booking)]);
    o.contenedores = txt(s && s[col(S.container)]);
    o.fecha_carga_planta = isoOrNull(pr && pr[col(P.carga)]);
    o.fecha_consolidado = isoOrNull(pr && pr[col(P.consolidado)]);
    o.corte_documental = isoOrNull(pr && pr[col(P.corte)]);
    o.etd = isoOrNull(pr && pr[col(P.etd)]) || isoOrNull(s && s[col(S.etd)]);
    o.eta = isoOrNull(s && s[col(S.eta)]);

    // Pasos que ya figuran hechos en las planillas
    if (v && v.firmado) hito(k, 'firma', v.fecha || null, 'ventas');
    if (pr && esSi(pr[col(P.etiqueta)])) hito(k, 'etiqueta', null, 'proyeccion');
    if ((pr && (esSi(pr[col(P.booking)]) || txt(pr[col(P.nBooking)]))) || (s && txt(s[col(S.booking)])))
      hito(k, 'booking', null, pr ? 'proyeccion' : 'seguimiento', o.booking);
    if (s && esFecha(s[col(S.carga)])) hito(k, 'camiones', s[col(S.carga)], 'seguimiento');
    if (s && txt(s[col(S.container)])) hito(k, 'retiro', null, 'seguimiento', o.contenedores);
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
    MailApp.sendEmail({ to: CONFIG.MAIL_DESTINATARIOS.join(','), subject: 'Tracking Comex · ' + fecha + ' · sin alertas',
      htmlBody: '<p>Hoy no hay alertas en las operaciones abiertas.</p>' + (app ? '<p><a href="' + app + '">Abrir el tracking</a></p>' : '') });
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
    subject: 'Tracking Comex · ' + fecha + ' · ' + vencidas.length + ' para hoy, ' + proximas.length + ' próximas',
    htmlBody: tabla(vencidas, 'Para resolver hoy', '#b42318') + tabla(proximas, 'Vencen en los próximos días', '#9a6700') +
      (app ? '<p style="font-family:Arial;font-size:13px;margin-top:18px"><a href="' + app + '">Abrir el tracking</a></p>' : ''),
  });
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
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Para pruebas locales con Node
if (typeof module !== 'undefined') module.exports = { armarDatos, norm, CONFIG };
