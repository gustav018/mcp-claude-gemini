# Buzón de Coordinación MCP (Claude Code & Antigravity)

Servidor MCP (*Model Context Protocol*) local para la comunicación bidireccional y gestión de tareas entre **Claude Code** (rol `claude`, coordinador) y **Antigravity** (rol `antigravity`, constructor).

---

## 1. Instalación desde Git

Si clonas este repositorio en una máquina o carpeta nueva:

```powershell
# 1. Clonar el repositorio
git clone <URL_DEL_REPOSITORIO>
cd mcp-claude-gemini

# 2. Instalar dependencias del servidor MCP
cd buzon-mcp
npm install
```

---

## 2. Registro del Servidor MCP en las IAs

### En Claude Code (CLI)
Registra el servidor MCP a nivel de usuario (o dentro del repositorio con `--scope project`):
```powershell
claude mcp add buzon-coordinacion --scope user -e BUZON_YO=claude -e BUZON_RAIZ=D:/mcp-claude-gemini -- node D:/mcp-claude-gemini/buzon-mcp/src/servidor.js
```
*(Ajusta la ruta `D:/mcp-claude-gemini` a la ruta local real de tu clon o proyecto).*

### En Antigravity (IDE / CLI)
Agrega en `C:\Users\Gustavo\.gemini\config\mcp_config.json`:
```json
{
  "mcpServers": {
    "buzon-coordinacion": {
      "command": "node",
      "args": ["D:/mcp-claude-gemini/buzon-mcp/src/servidor.js"],
      "env": {
        "BUZON_YO": "antigravity",
        "BUZON_RAIZ": "D:/mcp-claude-gemini"
      }
    }
  }
}
```
O vía CLI:
```powershell
& "C:\Users\Gustavo\.gemini\bin\agy.exe" mcp add --env BUZON_YO=antigravity --env BUZON_RAIZ=D:/mcp-claude-gemini buzon-coordinacion node D:/mcp-claude-gemini/buzon-mcp/src/servidor.js
```

---

## 3. Instrucciones de Uso para las IAs

### Coordinador (`claude` / Claude Code)
1. Al abrir la sesión, ejecuta `ver_sesiones()` y `designar_primaria("coordinador")`.
2. Lee reportes pendientes con `leer_buzon(reclamar=true)`.
3. Emite instrucciones estructuradas con `enviar_mensaje(para="antigravity", tipo="instruccion", tarea="...", cuerpo="...", archivos=["..."])`.
4. Revisa reportes contra el código real y responde con `tipo="respuesta"`.
5. Para migraciones o aprobaciones protegidas: solicita a Gustavo que ejecute `node scripts/aprobar.js <tarea> <estado> "<nota>"`.
6. Marca los mensajes procesados con `marcar_leido("<id>")`.

### Constructor (`antigravity` / Antigravity IDE)
1. Al abrir la sesión, ejecuta `designar_primaria("constructor")`.
2. Lee las instrucciones del coordinador con `leer_buzon(reclamar=true)`.
3. Implementa el código y corre pruebas unitarias.
4. Cambia el estado de la tarea con `estado_tarea(tarea="...", estado="PENDIENTE_REVISION", nota="...")`.
5. Envía el reporte a Claude con `enviar_mensaje(para="claude", tipo="reporte", tarea="...", archivos=["docs/reports/..."], responde_a="...")`.
6. Marca la instrucción recibida con `marcar_leido("<id>")`.

---

## 4. Control Humano (Gustavo)
Los estados protegidos (`MIGRACION_APLICADA`, `VERIFY_APROBADO`, `DESPLEGADO_PROD`, `APROBADO_POR_GUSTAVO`) están bloqueados para las IAs.
Solo Gustavo puede aplicarlos ejecutando en su terminal:
```powershell
node buzon-mcp/scripts/aprobar.js <tarea> <estado> "<nota>"
```

---

## 5. Pruebas
Para ejecutar la suite de 30 pruebas automatizadas:
```powershell
cd buzon-mcp
npm test
```
Para ejecutar la prueba de integración de dos clientes en tiempo real:
```powershell
node test/e2e_dos_clientes.js
```
Consulte el informe detallado en [REPORTE_20261119_buzon-mcp-final.md](file:///d:/mcp-claude-gemini/REPORTE_20261119_buzon-mcp-final.md).
