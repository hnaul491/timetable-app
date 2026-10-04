from fastapi import FastAPI

from app.routers import custom_events, events, health, notes, semesters, settings, subjects, sync, tasks, review, google, preferences, documents, ai, search, backup


def create_app() -> FastAPI:
    app = FastAPI(title="Timetable API")
    for module in (health, events, notes, custom_events, tasks, subjects, semesters, settings, sync, google, review, preferences, documents, ai, search, backup):
        app.include_router(module.router)
    return app


app = create_app()
