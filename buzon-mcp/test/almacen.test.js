import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  encontrarRaizRepositorio,
  obtenerRutaCoordinacion,
  asegurarDirectorios,
  validarNombreArchivo,
  resolverRutaSegura,
  validarRutaArchivoAdjunto,
  escribirArchivoAtomico,
  verificarLimiteEspacio,
  registrarAuditoria
} from '../src/almacen.js';

test('Almacén: resolución de raíz y creación de directorios', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-test-'));
  try {
    const coordDir = asegurarDirectorios(tmpDir);
    assert.ok(fs.existsSync(coordDir));
    assert.ok(fs.existsSync(path.join(coordDir, 'mensajes')));
    assert.ok(fs.existsSync(path.join(coordDir, 'tareas')));
    assert.ok(fs.existsSync(path.join(coordDir, 'sesiones')));
    assert.ok(fs.existsSync(path.join(coordDir, 'recibos')));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Almacén: validación de nombres de archivo y nombres reservados', () => {
  // Nombres válidos
  assert.equal(validarNombreArchivo('mensaje-123.json'), true);
  assert.equal(validarNombreArchivo('f2-mantenimiento.json'), true);

  // Nombres con caracteres de control
  assert.throws(() => validarNombreArchivo('test\x00.json'), /caracteres de control/);
  assert.throws(() => validarNombreArchivo('test\n.json'), /caracteres de control/);

  // Nombres con rutas / o ..
  assert.throws(() => validarNombreArchivo('../escape.json'), /separadores de ruta ni "\.\."/);
  assert.throws(() => validarNombreArchivo('sub/escape.json'), /separadores de ruta ni "\.\."/);
  assert.throws(() => validarNombreArchivo('sub\\escape.json'), /separadores de ruta ni "\.\."/);

  // Nombres reservados de Windows
  assert.throws(() => validarNombreArchivo('CON'), /reservado en Windows/);
  assert.throws(() => validarNombreArchivo('con.json'), /reservado en Windows/);
  assert.throws(() => validarNombreArchivo('NUL'), /reservado en Windows/);
  assert.throws(() => validarNombreArchivo('nul.txt'), /reservado en Windows/);
  assert.throws(() => validarNombreArchivo('AUX'), /reservado en Windows/);
  assert.throws(() => validarNombreArchivo('COM1.json'), /reservado en Windows/);
  assert.throws(() => validarNombreArchivo('LPT2'), /reservado en Windows/);
});

test('Almacén: resolverRutaSegura rechaza escapes de carpeta', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-test-'));
  try {
    asegurarDirectorios(tmpDir);
    // Válido
    const ruta = resolverRutaSegura('mensajes', 'm_123.json', tmpDir);
    assert.ok(ruta.includes('mensajes'));

    // Intento con nombre inválido
    assert.throws(() => resolverRutaSegura('mensajes', '../otro.json', tmpDir));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Almacén: validarRutaArchivoAdjunto acepta relativas seguras y rechaza absolutas/escapes', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-test-'));
  try {
    // Válido
    assert.equal(validarRutaArchivoAdjunto('docs/reports/reporte.md', tmpDir), 'docs/reports/reporte.md');

    // Rechaza absolutas
    assert.throws(() => validarRutaArchivoAdjunto('C:/Users/test.md', tmpDir), /debe ser relativa/);

    // Rechaza escape con ..
    assert.throws(() => validarRutaArchivoAdjunto('../fuera.md', tmpDir), /archivo adjunto fuera del repositorio/);
    assert.throws(() => validarRutaArchivoAdjunto('docs/../../fuera.md', tmpDir), /archivo adjunto fuera del repositorio/);

    // Rechaza nombres reservados en segmento
    assert.throws(() => validarRutaArchivoAdjunto('docs/NUL/reporte.md', tmpDir), /reservado en Windows/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Almacén: escritura atómica y no sobrescritura', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-test-'));
  try {
    const ruta = path.join(tmpDir, 'test.txt');
    escribirArchivoAtomico(ruta, 'primer contenido');
    assert.equal(fs.readFileSync(ruta, 'utf8'), 'primer contenido');

    // Sobrescritura permitida por defecto
    escribirArchivoAtomico(ruta, 'segundo contenido');
    assert.equal(fs.readFileSync(ruta, 'utf8'), 'segundo contenido');

    // No sobrescritura lanza error si existe
    assert.throws(() => {
      escribirArchivoAtomico(ruta, 'tercer contenido', { noSobrescribir: true });
    }, /no puede sobrescribirse/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Almacén: auditoría no registra cuerpo y agrega líneas JSON', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-test-'));
  try {
    asegurarDirectorios(tmpDir);
    registrarAuditoria({
      evento: 'mensaje_enviado',
      id: 'm_123',
      de: 'claude',
      para: 'antigravity',
      cuerpo: 'ESTE CUERPO NO DEBE ESTAR EN AUDIT.LOG',
      bytes: 100
    }, tmpDir);

    const auditPath = path.join(tmpDir, 'docs', 'coordinacion', 'audit.log');
    assert.ok(fs.existsSync(auditPath));
    const contenido = fs.readFileSync(auditPath, 'utf8');
    const entrada = JSON.parse(contenido.trim());

    assert.equal(entrada.evento, 'mensaje_enviado');
    assert.equal(entrada.id, 'm_123');
    assert.equal(entrada.cuerpo, undefined, 'El cuerpo nunca debe guardarse en audit.log');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
