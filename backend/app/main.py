from fastapi import FastAPI

from app.routers import custom_events, events, health, notes, settings, sync


def create_app() -> FastAPI:
    app = FastAPI(title="Timetable API")
    for module in (health, events, notes, custom_events, settings, sync):
        app.include_router(module.router)
    return app


app = create_app()
