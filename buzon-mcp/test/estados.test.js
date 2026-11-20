import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validarEstadoMCP,
  validarEstadoHumano,
  ESTADOS_PERMITIDOS_MCP,
  ESTADOS_PROTEGIDOS
} from '../src/estados.js';

test('Estados: estados permitidos para MCP se validan correctamente', () => {
  for (const estado of ESTADOS_PERMITIDOS_MCP) {
    assert.equal(validarEstadoMCP(estado), estado);
    assert.equal(validarEstadoMCP(estado.toLowerCase()), estado);
  }
});

test('Estados: estados protegidos son rechazados tajantemente para MCP con mensaje claro', () => {
  for (const estado of ESTADOS_PROTEGIDOS) {
    assert.throws(
      () => validarEstadoMCP(estado),
      new RegExp(`Acción rechazada: el estado "${estado}" es PROTEGIDO`)
    );
  }
});

test('Estados: estados inexistentes o no reconocidos son rechazados', () => {
  assert.throws(() => validarEstadoMCP('TERMINADO_COMPLETO'), /Estado inválido/);
  assert.throws(() => validarEstadoMCP('HACKEADO'), /Estado inválido/);
  assert.throws(() => validarEstadoMCP(''), /El estado es obligatorio/);
});

test('Estados: validarEstadoHumano permite tanto estados regulares como protegidos', () => {
  for (const estado of ESTADOS_PERMITIDOS_MCP) {
    assert.equal(validarEstadoHumano(estado), estado);
  }
  for (const estado of ESTADOS_PROTEGIDOS) {
    assert.equal(validarEstadoHumano(estado), estado);
  }
  assert.throws(() => validarEstadoHumano('INVENTADO'), /Estado inválido/);
});
