import { Link, useNavigate } from "react-router";
import { EventForm } from "../components/EventForm";
import { useT } from "../i18n";
import { calendarHref } from "../lib/calendarLocation";
import { useToast } from "../components/ui/Toast";

export function NewEventPage() {
  const t = useT();
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <div className="flex flex-col gap-4">
      <Link to={calendarHref()} className="text-sm font-semibold text-accent">
        {t("event.backToCalendar")}
      </Link>
      <div className="flex max-w-xl flex-col gap-4 rounded-2xl border border-line bg-surface p-5 md:p-7">
        <h1 className="text-2xl font-bold tracking-tight">{t("event.newTitle")}</h1>
        <EventForm
          onDone={(id) => {
            toast.success(t("event.created"));
            navigate(id === null ? calendarHref() : `/events/${id}`);
          }}
          onCancel={() => navigate(calendarHref())}
        />
      </div>
    </div>
  );
}
