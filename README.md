# ⚡ AETHERYON BITÁCORA · Cloud v5.0

**Sistema de gestión de proyectos, grabaciones multimedia y documentación técnica.**  
Stack: **FastAPI + MongoDB Atlas + Cloudflare R2 + JWT Auth**  
Deploy: **Render** | Plataforma: **Web + PWA** (responsive)

---

## ✨ Funcionalidades

- **Gestión de proyectos** — CRUD completo con categorías, tags, nivel de acceso y color
- **Archivos** — Subida, descarga y visualización inline (imagen, video, audio, PDF, código)
- **Grabación multimedia** — Pantalla, webcam y micrófono desde el navegador. Con un **proyecto destino** seleccionado se sube a R2; con **"— Sin proyecto —"** se descarga directo al dispositivo
- **Screenshots** — Captura con un clic, se guarda en el proyecto activo (o se descarga si no hay proyecto)
- **IDE de código** — Editor integrado con resaltado de sintaxis (JS, Python, HTML, CSS, +)
- **Dashboard** — Métricas de almacenamiento por proyecto
- **Interfaz cyberpunk responsiva** — Funciona en desktop, tablet y mobile
- **Autenticación JWT** — Login con contraseña, token configurable (default 72 h)
- **PWA** — Planificada (manifest + service worker)

---

## Estructura del proyecto

```
Bitacora-Noir/
├── backend/
│   └── app.py                   # FastAPI — API completa (~563 líneas)
├── frontend/
│   ├── aetheryon_frontend.html  # SPA principal (~1768 líneas, refactor en curso)
│   ├── ide12.html               # Editor de código integrado (~1238 líneas)
│   └── assets/                  # Módulos JS/CSS extraídos (refactor progresivo)
│       ├── css/responsive.css   # Breakpoints, touch targets, safe-area
│       └── js/                  # platform, core, recorder, ui, ide-app
├── render.yaml                  # Config de deploy en Render
├── Procfile                     # Comando de inicio (uvicorn)
├── requirements.txt             # Dependencias Python
├── package.json                 # Dependencias Node (usado en experimento Capacitor)
├── capacitor.config.ts          # ⬒ Prueba de concepto Capacitor (archivada)
├── android/                     # ⬒ Proyecto Android generado (no mantenido)
├── CLAUDE.md                    # Guía de arquitectura para asistentes IA
└── LICENSE                      # MIT
```

---

## Deploy en Render — paso a paso

### 1. Infraestructura previa

**MongoDB Atlas**
1. Crear cuenta en [cloud.mongodb.com](https://cloud.mongodb.com)
2. Crear cluster gratuito M0
3. En *Database Access* → Crear usuario con permisos `readWriteAnyDatabase`
4. En *Network Access* → Agregar `0.0.0.0/0` (permitir todas las IPs para Render)
5. *Connect → Drivers* → Copiar la connection string

**Cloudflare R2**
1. Panel de Cloudflare → R2 Object Storage → Crear bucket `aetheryon-bitacora`
2. *Manage R2 API Tokens* → Create Token → permisos: Object Read & Write sobre el bucket
3. Copiar Account ID, Access Key ID y Secret Access Key

---

### 2. Deploy en Render

```bash
# Opción A: conectar repositorio GitHub
# 1. Push este directorio a un repo privado
# 2. En Render Dashboard → New Web Service → conectar el repo
# 3. Render detecta render.yaml automáticamente

# Opción B: render blueprint
render blueprint apply
```

### 3. Variables de entorno en Render

En el dashboard de Render → tu servicio → *Environment*:

| Variable | Valor |
|---|---|
| `MONGO_URI` | `mongodb+srv://user:pass@cluster.mongodb.net/...` |
| `MONGO_DB` | `aetheryon` |
| `R2_ACCOUNT_ID` | Tu Cloudflare Account ID |
| `R2_ACCESS_KEY` | R2 Access Key ID |
| `R2_SECRET_KEY` | R2 Secret Access Key |
| `R2_BUCKET` | `aetheryon-bitacora` |
| `R2_PUBLIC_URL` | *(opcional)* URL pública del bucket |
| `ACCESS_PASSWORD` | Contraseña de acceso al sistema |
| `JWT_SECRET` | String aleatorio de 64 caracteres |
| `JWT_EXPIRE_H` | `72` |

Generar JWT_SECRET:
```bash
python -c "import secrets; print(secrets.token_hex(32))"
```

---

## Desarrollo local

```bash
# 1. Crear entorno virtual
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# 2. Instalar dependencias
pip install -r requirements.txt

# 3. Configurar variables
cp .env.example .env
# Editar .env con tus valores

# 4. Ejecutar
uvicorn backend.app:app --reload --port 8000
```

Abrir: http://localhost:8000

> El frontend se sirve desde el backend: `GET /` → `aetheryon_frontend.html`, `GET /ide` → `ide12.html`.

---

## API Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Login — retorna JWT |
| GET | `/api/auth/verify` | Verificar token |
| GET | `/api/projects` | Listar proyectos |
| POST | `/api/projects` | Crear proyecto |
| GET | `/api/projects/{id}` | Ver proyecto + archivos |
| PUT | `/api/projects/{id}` | Actualizar proyecto |
| DELETE | `/api/projects/{id}` | Eliminar proyecto (+ archivos en R2) |
| GET | `/api/projects/{id}/files` | Listar archivos |
| POST | `/api/projects/{id}/upload` | Subir archivo |
| POST | `/api/projects/{id}/screenshot` | Guardar screenshot |
| POST | `/api/projects/{id}/recording` | Guardar grabación |
| POST | `/api/projects/{id}/save-file` | Guardar contenido de archivo |
| DELETE | `/api/projects/{id}/files/{path}` | Eliminar archivo |
| GET | `/api/projects/{id}/files/{path}` | Servir archivo (proxy desde R2) |
| GET | `/api/health` | Health check |
| GET | `/api/docs` | Documentación Swagger |

Todos los endpoints excepto `/api/auth/login` y `/api/health` requieren  
`Authorization: Bearer <token>` en el header.

---

## Compatibilidad Mobile

El frontend es **responsivo por diseño** y se adapta automáticamente al dispositivo:

- **Detección de plataforma** — `platform.js` agrega clases al `<html>` (`.is-mobile`, `.is-touch`, `.is-tablet`, `.is-pwa`) para ajustar UI y comportamientos
- **Botones contextuales** — "Grabar pantalla" se oculta en mobile (no existe `getDisplayMedia`)
- **Sidebar colapsable** — menú hamburger en mobile, se cierra automáticamente al navegar
- **Hit targets** — botones con área táctil mínima de 40×40 px
- **IDE mobile** — botón "← Volver" en toolbar, navegación adaptativa

### Ruta hacia PWA (Fase 2 — pendiente)
- `manifest.webmanifest` con iconos 192/512
- `sw.js` con estrategia cache-first para assets, network-only para API
- Service worker registrado desde `core.js`

---

## Notas de seguridad

- El token JWT expira en 72 horas por defecto (`JWT_EXPIRE_H`)
- Cambiar `ACCESS_PASSWORD` a algo seguro antes de hacer deploy
- `JWT_SECRET` debe ser un string aleatorio y secreto — Render puede generarlo automáticamente con `generateValue: true`
- Los archivos se sirven desde R2 a través del backend (con validación de auth), no directamente
- CORS está abierto (`*`) — necesario para el WebView mobile; no representa riesgo porque todos los endpoints sensibles requieren JWT

---

## Licencia

MIT © 2026 AETHERYON Systems

---

## Capturas

![Dashboard](Screenshot1.png)
![IDE](Screenshot2.png)
