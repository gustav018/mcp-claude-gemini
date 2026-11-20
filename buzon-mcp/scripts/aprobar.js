#!/usr/bin/env node

/**
 * Script de aprobación humana exclusivo para Gustavo.
 * Uso: node scripts/aprobar.js <tarea> <estado> "<nota>"
 * Ejemplo: node scripts/aprobar.js f2-mantenimiento MIGRACION_APLICADA "Migración 004 revisada y ejecutada en staging"
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { actualizarEstadoTarea, encontrarRaizRepositorio } from '../src/almacen.js';
import { TODOS_LOS_ESTADOS, ESTADOS_PROTEGIDOS } from '../src/estados.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const args = process.argv.slice(2);

if (args.length < 2) {
  console.error(`Uso incorrecto.`);
  console.error(`Uso: node scripts/aprobar.js <tarea> <estado> "<nota opcional>"`);
  console.error(`Estados válidos: ${TODOS_LOS_ESTADOS.join(', ')}`);
  console.error(`Estados protegidos: ${ESTADOS_PROTEGIDOS.join(', ')}`);
  process.exit(1);
}

const [tarea, estado, ...restoNotas] = args;
const nota = restoNotas.join(' ').trim();

try {
  const repoRoot = encontrarRaizRepositorio();
  const resultado = actualizarEstadoTarea({
    repoRoot,
    tarea,
    estado,
    nota,
    esHumano: true
  });

  console.log(`[APROBACIÓN REGISTRADA CON ÉXITO]`);
  console.log(`Tarea: ${resultado.tarea}`);
  console.log(`Estado: ${resultado.estado}`);
  console.log(`Aprobado por: ${resultado.actualizado_por}`);
  console.log(`Fecha: ${resultado.actualizado}`);
  if (resultado.nota) {
    console.log(`Nota: ${resultado.nota}`);
  }
} catch (err) {
  console.error(`Error al registrar aprobación: ${err.message}`);
  process.exit(1);
}
