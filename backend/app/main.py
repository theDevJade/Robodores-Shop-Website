from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from .core.database import init_db
from .core.config import get_settings
from .routers import (
    auth,
    attendance,
    exports,
    inventory,
    jobs,
    manufacturing,
    orders,
    schedules,
    settings as settings_router,
    tickets,
)

app_settings = get_settings()

def build_app() -> FastAPI:
    init_db()
    app = FastAPI(title=app_settings.app_name)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.allowed_hosts,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth.router)
    app.include_router(attendance.router)
    app.include_router(schedules.router)
    app.include_router(jobs.router)
    app.include_router(manufacturing.router)
    app.include_router(inventory.router)
    app.include_router(orders.router)
    app.include_router(exports.router)
    app.include_router(settings_router.router)
    app.include_router(tickets.router)
    app.mount("/uploads", StaticFiles(directory=app_settings.upload_root, html=False), name="uploads")
    return app

app = build_app()
