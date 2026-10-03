from fastapi import FastAPI

from app.routers import custom_events, events, health, notes, settings, subjects, sync, tasks


def create_app() -> FastAPI:
    app = FastAPI(title="Timetable API")
    for module in (health, events, notes, custom_events, tasks, subjects, settings, sync):
        app.include_router(module.router)
    return app


app = create_app()
