import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GestorSesiones } from '../src/sesiones.js';

test('Sesiones: inicialización y generación de ID', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-sesiones-'));
  try {
    const sesion = new GestorSesiones({
      rol: 'claude',
      repoRoot: tmpDir,
      etiqueta: 'coordinador'
    });

    assert.equal(sesion.rol, 'claude');
    assert.equal(sesion.etiqueta, 'coordinador');
    assert.ok(sesion.sesionId.startsWith('s_'));
    assert.equal(sesion.esPrimaria(), false); // Todavía no se ha designado primaria
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Sesiones: designar primaria y rechazar segunda sesión sin forzar', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-sesiones-'));
  try {
    const s1 = new GestorSesiones({
      rol: 'claude',
      repoRoot: tmpDir,
      etiqueta: 'coordinador-1'
    });

    // s1 se designa primaria
    s1.designarPrimaria('coordinador-1');
    assert.equal(s1.esPrimaria(), true);

    // s2 intenta ser primaria
    const s2 = new GestorSesiones({
      rol: 'claude',
      repoRoot: tmpDir,
      etiqueta: 'coordinador-2'
    });
    assert.equal(s2.esPrimaria(), false);

    // s2 intenta designar primaria sin forzar -> DEBE fallar
    assert.throws(
      () => s2.designarPrimaria('coordinador-2', false),
      /No se puede tomar la sesión primaria del rol "claude" porque ya está asignada/
    );

    // s1 sigue siendo la primaria
    assert.equal(s1.esPrimaria(), true);
    assert.equal(s2.esPrimaria(), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Sesiones: relevo forzado con forzar=true y alerta para sesión desbancada', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-sesiones-'));
  try {
    const s1 = new GestorSesiones({
      rol: 'antigravity',
      repoRoot: tmpDir,
      etiqueta: 'constructor-original'
    });
    s1.designarPrimaria('constructor-original');
    assert.equal(s1.esPrimaria(), true);

    const s2 = new GestorSesiones({
      rol: 'antigravity',
      repoRoot: tmpDir,
      etiqueta: 'constructor-nuevo'
    });

    // s2 fuerza el relevo
    const res = s2.designarPrimaria('constructor-nuevo', true);
    assert.equal(res.accion, 'forzar_primaria');
    assert.equal(s2.esPrimaria(), true);
    assert.equal(s1.esPrimaria(), false);

    // s1 debe recibir la alerta de que fue desbancada
    const alerta = s1.comprobarAlertas();
    assert.ok(alerta);
    assert.match(alerta, /fue relevada forzosamente por la sesión "constructor-nuevo"/);

    // Segunda comprobación: la alerta ya se consumió
    assert.equal(s1.comprobarAlertas(), null);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Sesiones: relevo automático cuando la primaria está vencida (TTL)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-sesiones-'));
  try {
    const s1 = new GestorSesiones({
      rol: 'claude',
      repoRoot: tmpDir,
      etiqueta: 'coordinador-viejo'
    });
    s1.designarPrimaria('coordinador-viejo');

    // Simular que el latido de s1 fue hace 20 minutos
    const rutaPrimaria = path.join(tmpDir, 'docs', 'coordinacion', 'sesiones', 'claude.json');
    const data = JSON.parse(fs.readFileSync(rutaPrimaria, 'utf8'));
    data.ultimo_latido = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    fs.writeFileSync(rutaPrimaria, JSON.stringify(data, null, 2));

    const s2 = new GestorSesiones({
      rol: 'claude',
      repoRoot: tmpDir,
      etiqueta: 'coordinador-nuevo'
    });

    // Como s1 está vencida (> 15 min), s2 puede relevarla sin forzar=true
    const relevoExitoso = s2.intentarRelevoAutomatico();
    assert.equal(relevoExitoso, true);
    assert.equal(s2.esPrimaria(), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('Sesiones: verSesiones reporta primaria y secundarias para ambos roles', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'buzon-sesiones-'));
  try {
    const claudePrimaria = new GestorSesiones({
      rol: 'claude',
      repoRoot: tmpDir,
      etiqueta: 'claude-p'
    });
    claudePrimaria.designarPrimaria('claude-p');

    const claudeSecundaria = new GestorSesiones({
      rol: 'claude',
      repoRoot: tmpDir,
      etiqueta: 'claude-s'
    });

    const info = claudeSecundaria.verSesiones();
    assert.equal(info.mi_sesion.rol, 'claude');
    assert.equal(info.mi_sesion.es_primaria, false);
    assert.equal(info.roles.claude.primaria.etiqueta, 'claude-p');
    assert.equal(info.roles.claude.secundarias.length, 1);
    assert.equal(info.roles.claude.secundarias[0].etiqueta, 'claude-s');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
