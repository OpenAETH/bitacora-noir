# AETHERYON BITÁCORA · Cloud v5.0

Sistema de gestión de proyectos, grabaciones y documentación.  
Stack: **FastAPI + MongoDB Atlas + Cloudflare R2 + JWT Auth**  
Deploy: **Render**

---

## Estructura del proyecto

```
aetheryon-cloud/
├── backend/
│   └── app.py              # FastAPI + MongoDB + R2 + Auth
├── frontend/
│   ├── aetheryon_frontend.html   # UI principal (login + responsive)
│   └── ide12.html                # Editor de código integrado
├── render.yaml             # Configuración de deploy en Render
├── Procfile                # Comando de inicio
├── requirements.txt        # Dependencias Python
├── .env.example            # Variables de entorno de referencia
└── .gitignore
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

---

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/login` | Login — retorna JWT |
| GET | `/api/auth/verify` | Verificar token |
| GET | `/api/projects` | Listar proyectos |
| POST | `/api/projects` | Crear proyecto |
| GET | `/api/projects/{id}/files` | Listar archivos (R2) |
| POST | `/api/projects/{id}/upload` | Subir archivo |
| POST | `/api/projects/{id}/screenshot` | Guardar captura |
| POST | `/api/projects/{id}/recording` | Guardar grabación |
| GET | `/api/projects/{id}/files/{path}` | Servir archivo desde R2 |
| GET | `/api/health` | Health check |
| GET | `/api/docs` | Documentación Swagger |

Todos los endpoints excepto `/api/auth/login` y `/api/health` requieren  
`Authorization: Bearer <token>` en el header.

---

## Notas de seguridad

- El token JWT expira en 72 horas por defecto (`JWT_EXPIRE_H`)
- Cambiar `ACCESS_PASSWORD` a algo seguro antes de hacer deploy
- `JWT_SECRET` debe ser un string aleatorio y secreto — Render puede generarlo automáticamente con `generateValue: true`
- Los archivos se sirven desde R2 a través del backend (con validación de auth), no directamente

---

*build with 🧡 by AETHERYON Systems*
