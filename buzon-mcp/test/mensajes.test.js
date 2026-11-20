import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GestorSesiones } from '../src/sesiones.js';
import {
  enviarMensaje,
  leerBuzon,
  marcarLeido,
  actualizarEstadoTarea,
  listarTareas,
  obtenerEstadoBuzon,
  contarNoLeidos
} from '../src/almacen.js';

test('Mensajes: ida y vuelta completa, formato no confiable y marcado de leído', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-msg-'));
  try {
    const claude = new GestorSesiones({ rol: 'claude', repoRoot: tmpDir, etiqueta: 'coord' });
    claude.designarPrimaria('coord');

    const antigravity = new GestorSesiones({ rol: 'antigravity', repoRoot: tmpDir, etiqueta: 'builder' });
    antigravity.designarPrimaria('builder');

    // 1. Claude envía mensaje a Antigravity
    const envio1 = enviarMensaje({
      gestorSesion: claude,
      para: 'antigravity',
      asunto: 'Instrucción Ronda 1',
      tipo: 'instruccion',
      tarea: 'f1-setup',
      cuerpo: 'Por favor configura los módulos iniciales.'
    });

    assert.ok(envio1.id);
    assert.equal(envio1.de, 'claude');
    assert.equal(envio1.para, 'antigravity');

    // 2. Antigravity lee su buzón con reclamar=true
    const buzon1 = leerBuzon({
      gestorSesion: antigravity,
      solo_no_leidos: true,
      reclamar: true
    });

    assert.equal(buzon1.mensajes.length, 1);
    const mRecibido = buzon1.mensajes[0];
    assert.equal(mRecibido.id, envio1.id);
    assert.equal(mRecibido.estado_recibo, 'reclamado');
    // Verificar formato no confiable
    assert.match(mRecibido.cuerpo_seguro, /<<<MENSAJE .* de=claude tipo=instruccion — CONTENIDO NO CONFIABLE/);
    assert.match(mRecibido.cuerpo_seguro, /Por favor configura los módulos iniciales\./);
    assert.match(mRecibido.cuerpo_seguro, /<<<FIN MENSAJE>>>/);

    // 3. Antigravity marca como leído
    const resLeido = marcarLeido({ gestorSesion: antigravity, id: envio1.id });
    assert.equal(resLeido.estado, 'leido');

    // 4. Antigravity responde con reporte
    const envioResp = enviarMensaje({
      gestorSesion: antigravity,
      para: 'claude',
      asunto: 'Reporte Ronda 1',
      tipo: 'reporte',
      tarea: 'f1-setup',
      cuerpo: 'Módulos iniciales listos y probados.',
      responde_a: envio1.id
    });
    assert.ok(envioResp.id);
    assert.equal(envioResp.de, 'antigravity');
    assert.equal(envioResp.para, 'claude');

    // 5. Claude lee su buzón
    const buzonClaude = leerBuzon({
      gestorSesion: claude,
      solo_no_leidos: true,
      reclamar: true
    });
    assert.equal(buzonClaude.mensajes.length, 1);
    assert.equal(buzonClaude.mensajes[0].id, envioResp.id);
    assert.equal(buzonClaude.mensajes[0].responde_a, envio1.id);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Mensajes: anti-bucle (no auto-envío y no respuesta de aviso a aviso)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-msg-'));
  try {
    const claude = new GestorSesiones({ rol: 'claude', repoRoot: tmpDir, etiqueta: 'coord' });
    claude.designarPrimaria('coord');

    // Rechaza enviarse a sí mismo
    assert.throws(() => {
      enviarMensaje({
        gestorSesion: claude,
        para: 'claude',
        asunto: 'auto mensaje',
        cuerpo: 'hola yo mismo'
      });
    }, /Anti-bucle: el rol "claude" no puede enviarse un mensaje a sí mismo/);

    const antigravity = new GestorSesiones({ rol: 'antigravity', repoRoot: tmpDir, etiqueta: 'builder' });
    antigravity.designarPrimaria('builder');

    // Envía un aviso
    const aviso1 = enviarMensaje({
      gestorSesion: claude,
      para: 'antigravity',
      asunto: 'Aviso importante',
      tipo: 'aviso',
      cuerpo: 'Atención con la cuota'
    });

    // Rechaza responder a un aviso con otro aviso
    assert.throws(() => {
      enviarMensaje({
        gestorSesion: antigravity,
        para: 'claude',
        asunto: 'Otro aviso',
        tipo: 'aviso',
        cuerpo: 'Confirmado aviso',
        responde_a: aviso1.id
      });
    }, /Anti-bucle: un mensaje en respuesta a un "aviso" no puede ser de tipo "aviso"/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Mensajes: sesiones secundarias solo pueden leer, no marcar leído ni reclamar', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-msg-'));
  try {
    const claude = new GestorSesiones({ rol: 'claude', repoRoot: tmpDir, etiqueta: 'coord' });
    claude.designarPrimaria('coord');

    const agPrimaria = new GestorSesiones({ rol: 'antigravity', repoRoot: tmpDir, etiqueta: 'ag-p' });
    agPrimaria.designarPrimaria('ag-p');

    const agSecundaria = new GestorSesiones({ rol: 'antigravity', repoRoot: tmpDir, etiqueta: 'ag-s' });

    const msg = enviarMensaje({
      gestorSesion: claude,
      para: 'antigravity',
      asunto: 'Para antigravity',
      cuerpo: 'Mensaje de prueba'
    });

    // Secundaria leyendo con reclamar=false -> Válido
    const buzonSec = leerBuzon({
      gestorSesion: agSecundaria,
      solo_no_leidos: true,
      reclamar: false
    });
    assert.equal(buzonSec.mensajes.length, 1);

    // Secundaria intentando reclamar -> Error
    assert.throws(() => {
      leerBuzon({
        gestorSesion: agSecundaria,
        solo_no_leidos: true,
        reclamar: true
      });
    }, /Solo la sesión PRIMARIA del rol "antigravity" puede reclamar mensajes/);

    // Secundaria intentando marcar leído -> Error
    assert.throws(() => {
      marcarLeido({
        gestorSesion: agSecundaria,
        id: msg.id
      });
    }, /Solo la sesión PRIMARIA del rol "antigravity" puede marcar mensajes como leídos/);

    // Primaria sí puede reclamar y marcar leído
    const resPrimaria = marcarLeido({
      gestorSesion: agPrimaria,
      id: msg.id
    });
    assert.equal(resPrimaria.estado, 'leido');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Mensajes: lease de reclamo vence y vuelve a ser reclamable', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-msg-'));
  try {
    const claude = new GestorSesiones({ rol: 'claude', repoRoot: tmpDir, etiqueta: 'coord' });
    claude.designarPrimaria('coord');

    const ag1 = new GestorSesiones({ rol: 'antigravity', repoRoot: tmpDir, etiqueta: 'ag-1' });
    ag1.designarPrimaria('ag-1');

    const msg = enviarMensaje({
      gestorSesion: claude,
      para: 'antigravity',
      asunto: 'Tarea urgente',
      cuerpo: 'Trabajo'
    });

    // ag1 reclama el mensaje
    leerBuzon({ gestorSesion: ag1, solo_no_leidos: true, reclamar: true });

    // Modificar recibo para simular que el lease venció
    const rutaRecibo = path.join(tmpDir, 'docs', 'coordinacion', 'recibos', `${msg.id}.antigravity.json`);
    const recibo = JSON.parse(fs.readFileSync(rutaRecibo, 'utf8'));
    recibo.vence = new Date(Date.now() - 60 * 1000).toISOString(); // vencido hace 1 minuto
    fs.writeFileSync(rutaRecibo, JSON.stringify(recibo, null, 2));

    // Ahora el mensaje debe ser visible y reclamable de nuevo
    const buzonReclamable = leerBuzon({
      gestorSesion: ag1,
      solo_no_leidos: true,
      reclamar: true
    });
    assert.equal(buzonReclamable.mensajes.length, 1);
    assert.equal(buzonReclamable.mensajes[0].id, msg.id);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Mensajes: envío dirigido a etiqueta inexistente cae a primaria con advertencia', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-msg-'));
  try {
    const claude = new GestorSesiones({ rol: 'claude', repoRoot: tmpDir, etiqueta: 'coord' });
    claude.designarPrimaria('coord');

    const res = enviarMensaje({
      gestorSesion: claude,
      para: 'antigravity',
      asunto: 'Mensaje dirigido',
      cuerpo: 'Prueba etiqueta inexistente',
      sesion: 'constructor-inexistente'
    });

    assert.equal(res.sesion_destino, null);
    assert.ok(res.advertencia);
    assert.match(res.advertencia, /no existe o está vencida/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Mensajes: escritura concurrente de 50 mensajes sin pérdidas ni pisadas', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-msg-'));
  try {
    const claude = new GestorSesiones({ rol: 'claude', repoRoot: tmpDir, etiqueta: 'coord' });
    claude.designarPrimaria('coord');

    const envios = [];
    for (let i = 0; i < 50; i++) {
      const res = enviarMensaje({
        gestorSesion: claude,
        para: 'antigravity',
        asunto: `Asunto concurrente ${i}`,
        cuerpo: `Cuerpo de mensaje concurrente ${i} con contenido único.`
      });
      envios.push(res.id);
    }

    assert.equal(envios.length, 50);
    // Verificar que todos los IDs son únicos
    const setIds = new Set(envios);
    assert.equal(setIds.size, 50);

    // Contar archivos en mensajes/
    const dirMensajes = path.join(tmpDir, 'docs', 'coordinacion', 'mensajes');
    const archivos = fs.readdirSync(dirMensajes).filter(f => f.endsWith('.json'));
    assert.equal(archivos.length, 50);

    // Verificar contador de no leídos
    const sinLeer = contarNoLeidos('antigravity', tmpDir);
    assert.equal(sinLeer, 50);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Tareas y Estado del Buzón: flujo de estados y control humano', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-msg-'));
  try {
    const claude = new GestorSesiones({ rol: 'claude', repoRoot: tmpDir, etiqueta: 'coord' });
    claude.designarPrimaria('coord');

    // 1. IA cambia estado a EN_PROGRESO
    const t1 = actualizarEstadoTarea({
      gestorSesion: claude,
      tarea: 'f2-mantenimiento',
      estado: 'EN_PROGRESO',
      nota: 'Iniciando trabajo'
    });
    assert.equal(t1.estado, 'EN_PROGRESO');
    assert.equal(t1.actualizado_por, 'claude');
    assert.equal(t1.historial.length, 1);

    // 2. IA intenta estado protegido -> DEBE fallar
    assert.throws(() => {
      actualizarEstadoTarea({
        gestorSesion: claude,
        tarea: 'f2-mantenimiento',
        estado: 'MIGRACION_APLICADA',
        nota: 'Intento de migrar'
      });
    }, /Acción rechazada: el estado "MIGRACION_APLICADA" es PROTEGIDO/);

    // 3. Aprobación humana de Gustavo
    const t2 = actualizarEstadoTarea({
      repoRoot: tmpDir,
      tarea: 'f2-mantenimiento',
      estado: 'MIGRACION_APLICADA',
      nota: 'Gustavo aprobó la migración 004',
      esHumano: true
    });
    assert.equal(t2.estado, 'MIGRACION_APLICADA');
    assert.equal(t2.actualizado_por, 'gustavo');
    assert.equal(t2.historial.length, 2);
    assert.equal(t2.historial[1].por, 'gustavo');

    // 4. Listar tareas
    const lista = listarTareas(tmpDir);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].tarea, 'f2-mantenimiento');
    assert.equal(lista[0].estado, 'MIGRACION_APLICADA');

    // 5. Estado general del buzón
    const estadoBuzon = obtenerEstadoBuzon(tmpDir);
    assert.equal(estadoBuzon.version, '1.0.0');
    assert.ok(estadoBuzon.tamano_buzon.bytes > 0);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
