import { FormEvent, useMemo, useState } from "react";
import {
  addDays,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  Calendar as CalendarIcon,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { CalendarEvent, CalendarViewType } from "@/types/calendar";
import { mockEvents } from "@/data/calendarMockData";
import { cn } from "@/lib/utils";

const weekDayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function eventColor(event: CalendarEvent) {
  return event.color || "#246fdb";
}

function formatRange(start: Date, end: Date) {
  return `${format(start, "HH:mm")} - ${format(end, "HH:mm")}`;
}

export default function CalendarPage() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [view, setView] = useState<CalendarViewType>("month");
  const [events, setEvents] = useState<CalendarEvent[]>(mockEvents);
  const [query, setQuery] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDate, setNewDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [newStart, setNewStart] = useState("09:00");
  const [newEnd, setNewEnd] = useState("10:00");
  const [newLocation, setNewLocation] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const monthDays = eachDayOfInterval({
    start: startOfWeek(monthStart, { weekStartsOn: 0 }),
    end: endOfWeek(monthEnd, { weekStartsOn: 0 }),
  });
  const weekDays = eachDayOfInterval({
    start: startOfWeek(currentDate, { weekStartsOn: 0 }),
    end: endOfWeek(currentDate, { weekStartsOn: 0 }),
  });

  const filteredEvents = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return events.filter((event) => {
      return (
        !normalized ||
        event.title.toLowerCase().includes(normalized) ||
        event.description?.toLowerCase().includes(normalized) ||
        event.location?.toLowerCase().includes(normalized)
      );
    });
  }, [events, query]);

  const selectedDayEvents = useMemo(
    () => filteredEvents.filter((event) => isSameDay(event.start_time, currentDate)).sort((a, b) => a.start_time.getTime() - b.start_time.getTime()),
    [currentDate, filteredEvents],
  );

  const navigate = (direction: 1 | -1) => {
    const fn =
      direction === 1
        ? view === "day"
          ? addDays
          : view === "week"
            ? addWeeks
            : addMonths
        : view === "day"
          ? subDays
          : view === "week"
            ? subWeeks
            : subMonths;
    setCurrentDate(fn(currentDate, 1));
  };

  const headerLabel =
    view === "day"
      ? format(currentDate, "d 'de' MMMM 'de' yyyy", { locale: ptBR })
      : view === "week"
        ? `${format(weekDays[0], "dd MMM", { locale: ptBR })} - ${format(weekDays[6], "dd MMM yyyy", { locale: ptBR })}`
        : format(currentDate, "MMMM yyyy", { locale: ptBR });

  const createEvent = (event: FormEvent) => {
    event.preventDefault();
    const title = newTitle.trim();
    if (!title) return;

    const start = new Date(`${newDate}T${newStart}`);
    const end = new Date(`${newDate}T${newEnd}`);
    const now = new Date();

    setEvents((current) => [
      {
        id: crypto.randomUUID(),
        calendar_id: "cal-1",
        creator_id: "local-user",
        title,
        description: newDescription.trim() || undefined,
        location: newLocation.trim() || undefined,
        status: "confirmed",
        start_time: start,
        end_time: end > start ? end : addDays(start, 0),
        all_day: false,
        visibility: "default",
        transparency: "opaque",
        attendees: [],
        reminders: [],
        created: now,
        updated: now,
        color: "#246fdb",
      },
      ...current,
    ]);
    setCurrentDate(start);
    setShowNewEvent(false);
    setNewTitle("");
    setNewLocation("");
    setNewDescription("");
  };

  const deleteSelectedEvent = () => {
    if (!selectedEvent) return;
    setEvents((current) => current.filter((event) => event.id !== selectedEvent.id));
    setSelectedEvent(null);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
      <header className="border-b border-border bg-card px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h1 className="text-2xl font-bold capitalize tracking-tight">{headerLabel}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Agenda local com eventos mockados e novos eventos da sessão.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => navigate(-1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background transition hover:border-primary hover:text-primary">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button onClick={() => navigate(1)} className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-background transition hover:border-primary hover:text-primary">
              <ChevronRight className="h-4 w-4" />
            </button>
            <button onClick={() => setCurrentDate(new Date())} className="h-10 rounded-lg border border-border bg-background px-4 text-sm font-semibold transition hover:border-primary hover:text-primary">
              Hoje
            </button>
            <select value={view} onChange={(event) => setView(event.target.value as CalendarViewType)} className="h-10 rounded-lg border border-border bg-background px-3 text-sm font-semibold outline-none">
              <option value="month">Mês</option>
              <option value="week">Semana</option>
              <option value="day">Dia</option>
            </select>
            <div className="relative w-full min-w-[260px] xl:w-[320px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
                placeholder="Buscar eventos..."
                type="search"
              />
            </div>
            <button
              onClick={() => {
                setNewDate(format(currentDate, "yyyy-MM-dd"));
                setShowNewEvent(true);
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Novo evento
            </button>
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] gap-4 overflow-hidden p-4 max-xl:grid-cols-1">
        <main className="min-h-0 overflow-hidden rounded-xl border border-border bg-card">
          {view === "month" ? (
            <MonthView
              days={monthDays}
              currentDate={currentDate}
              events={filteredEvents}
              onSelectDate={setCurrentDate}
              onSelectEvent={setSelectedEvent}
            />
          ) : (
            <AgendaView
              days={view === "day" ? [currentDate] : weekDays}
              events={filteredEvents}
              onSelectDate={setCurrentDate}
              onSelectEvent={setSelectedEvent}
            />
          )}
        </main>

        <aside className="min-h-0 overflow-auto rounded-xl border border-border bg-card p-4 scrollbar-thin">
          <Calendar
            mode="single"
            selected={currentDate}
            onSelect={(date) => date && setCurrentDate(date)}
            locale={ptBR}
            className="mx-auto"
          />

          <div className="mt-4 rounded-xl border border-border bg-background p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-bold">Carga do dia</h2>
                <p className="text-sm text-muted-foreground">{format(currentDate, "dd 'de' MMMM", { locale: ptBR })}</p>
              </div>
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 font-bold text-primary">
                {selectedDayEvents.length}
              </span>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {selectedDayEvents.length ? "Eventos agendados para a data selecionada." : "Nenhum evento para a data selecionada."}
            </p>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-background p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-bold">Eventos do dia</h2>
              <button className="text-xs font-semibold text-primary">Ver todos</button>
            </div>
            <div className="space-y-2">
              {selectedDayEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                  Sem compromissos nesta data.
                </div>
              ) : (
                selectedDayEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => setSelectedEvent(event)}
                    className="w-full rounded-lg border border-border p-3 text-left transition hover:border-primary"
                  >
                    <div className="flex items-start gap-2">
                      <span className="mt-1 h-2 w-2 rounded-full" style={{ backgroundColor: eventColor(event) }} />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{event.title}</p>
                        <p className="text-xs text-muted-foreground">{event.all_day ? "Dia inteiro" : formatRange(event.start_time, event.end_time)}</p>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="mt-4 rounded-xl border border-border bg-background p-4">
            <div className="mb-3 flex items-center gap-2">
              <CheckSquare className="h-4 w-4 text-primary" />
              <h2 className="font-bold">Tarefas</h2>
            </div>
            <p className="text-sm text-muted-foreground">Não há fonte de tarefas conectada a este painel do calendário.</p>
          </div>
        </aside>
      </div>

      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="mb-2 h-2 w-14 rounded-full" style={{ backgroundColor: eventColor(selectedEvent) }} />
                <h2 className="text-xl font-bold">{selectedEvent.title}</h2>
              </div>
              <button onClick={() => setSelectedEvent(null)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 space-y-3 text-sm text-muted-foreground">
              <p className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-primary" />
                {selectedEvent.all_day
                  ? format(selectedEvent.start_time, "dd/MM/yyyy")
                  : `${format(selectedEvent.start_time, "dd/MM/yyyy HH:mm")} - ${format(selectedEvent.end_time, "HH:mm")}`}
              </p>
              {selectedEvent.location && (
                <p className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  {selectedEvent.location}
                </p>
              )}
              {selectedEvent.description && <p className="rounded-lg bg-muted p-3">{selectedEvent.description}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={deleteSelectedEvent} className="inline-flex h-10 items-center gap-2 rounded-lg border border-destructive/40 px-4 text-sm font-semibold text-destructive hover:bg-destructive/10">
                <Trash2 className="h-4 w-4" />
                Excluir
              </button>
              <button onClick={() => setSelectedEvent(null)} className="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground">
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}

      {showNewEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 px-4 backdrop-blur-sm">
          <form onSubmit={createEvent} className="w-full max-w-lg rounded-xl border border-border bg-card p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">Novo evento</h2>
                <p className="mt-1 text-sm text-muted-foreground">Evento criado localmente nesta sessão.</p>
              </div>
              <button type="button" onClick={() => setShowNewEvent(false)} className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:border-primary hover:text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-5 grid gap-4">
              <label className="space-y-1.5 text-sm font-semibold">
                <span>Título *</span>
                <input value={newTitle} onChange={(event) => setNewTitle(event.target.value)} required className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </label>
              <div className="grid gap-4 md:grid-cols-3">
                <label className="space-y-1.5 text-sm font-semibold">
                  <span>Data</span>
                  <input type="date" value={newDate} onChange={(event) => setNewDate(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                </label>
                <label className="space-y-1.5 text-sm font-semibold">
                  <span>Início</span>
                  <input type="time" value={newStart} onChange={(event) => setNewStart(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                </label>
                <label className="space-y-1.5 text-sm font-semibold">
                  <span>Fim</span>
                  <input type="time" value={newEnd} onChange={(event) => setNewEnd(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
                </label>
              </div>
              <label className="space-y-1.5 text-sm font-semibold">
                <span>Local ou link</span>
                <input value={newLocation} onChange={(event) => setNewLocation(event.target.value)} className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </label>
              <label className="space-y-1.5 text-sm font-semibold">
                <span>Descrição</span>
                <textarea value={newDescription} onChange={(event) => setNewDescription(event.target.value)} className="min-h-[90px] w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
              </label>
            </div>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setShowNewEvent(false)} className="h-10 rounded-lg border border-border px-4 text-sm font-semibold">
                Cancelar
              </button>
              <button type="submit" className="h-10 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground">
                Criar evento
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function MonthView({
  days,
  currentDate,
  events,
  onSelectDate,
  onSelectEvent,
}: {
  days: Date[];
  currentDate: Date;
  events: CalendarEvent[];
  onSelectDate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {weekDayNames.map((day) => (
          <div key={day} className="px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {day}
          </div>
        ))}
      </div>
      <div className="grid flex-1 grid-cols-7 auto-rows-fr">
        {days.map((day) => {
          const dayEvents = events.filter((event) => isSameDay(event.start_time, day));
          return (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onSelectDate(day)}
              className={cn(
                "min-h-[112px] border-b border-r border-border p-2 text-left transition hover:bg-muted/40",
                !isSameMonth(day, currentDate) && "bg-muted/20 text-muted-foreground",
                isSameDay(day, currentDate) && "bg-primary/5",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold",
                  isToday(day) && "bg-primary text-primary-foreground",
                )}
              >
                {format(day, "d")}
              </span>
              <div className="mt-2 space-y-1">
                {dayEvents.slice(0, 3).map((event) => (
                  <span
                    key={event.id}
                    onClick={(click) => {
                      click.stopPropagation();
                      onSelectEvent(event);
                    }}
                    className="block truncate rounded-md px-2 py-1 text-xs text-white"
                    style={{ backgroundColor: eventColor(event) }}
                  >
                    {event.all_day ? event.title : `${format(event.start_time, "HH:mm")} ${event.title}`}
                  </span>
                ))}
                {dayEvents.length > 3 && <span className="block px-2 text-xs text-muted-foreground">+{dayEvents.length - 3} mais</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AgendaView({
  days,
  events,
  onSelectDate,
  onSelectEvent,
}: {
  days: Date[];
  events: CalendarEvent[];
  onSelectDate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
}) {
  return (
    <div className="grid h-full min-w-[760px]" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
      {days.map((day) => {
        const dayEvents = events.filter((event) => isSameDay(event.start_time, day)).sort((a, b) => a.start_time.getTime() - b.start_time.getTime());
        return (
          <section key={day.toISOString()} className="border-r border-border p-4 last:border-r-0">
            <button
              type="button"
              onClick={() => onSelectDate(day)}
              className={cn(
                "mb-4 flex w-full items-center justify-between rounded-lg border border-border bg-background px-3 py-2 text-left",
                isToday(day) && "border-primary text-primary",
              )}
            >
              <span>
                <span className="block text-xs uppercase text-muted-foreground">{format(day, "EEE", { locale: ptBR })}</span>
                <span className="font-bold">{format(day, "dd/MM")}</span>
              </span>
              <CalendarIcon className="h-4 w-4" />
            </button>
            <div className="space-y-3">
              {dayEvents.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">Sem eventos.</div>
              ) : (
                dayEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => onSelectEvent(event)}
                    className="w-full rounded-lg border border-border bg-background p-3 text-left transition hover:border-primary"
                  >
                    <div className="mb-2 h-1.5 w-12 rounded-full" style={{ backgroundColor: eventColor(event) }} />
                    <p className="font-semibold">{event.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{event.all_day ? "Dia inteiro" : formatRange(event.start_time, event.end_time)}</p>
                  </button>
                ))
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
