"use client";

import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import listPlugin from "@fullcalendar/react/list";
import classicThemePlugin from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import { useState } from "react";
import { formatRM } from "@/lib/shared/money";

export interface CalendarEntry {
  id: string;
  title: string;
  date: Date;
  color: string;
  amount: number;
  /** Projected recurring copy that hasn't been generated yet. */
  projected?: boolean;
}

/** Monthly calendar of bills, coloured by payment status. */
export default function BillCalendar({ entries, onSelect }: { entries: CalendarEntry[]; onSelect: (id: string) => void }) {
  // Phones get a month list instead of a cramped grid.
  const [narrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches);
  return (
    <div className="mf-calendar">
      <FullCalendar
        plugins={[dayGridPlugin, listPlugin, interactionPlugin, classicThemePlugin]}
        initialView={narrow ? "listMonth" : "dayGridMonth"}
        headerToolbar={narrow ? { start: "title", end: "prev,next" } : { start: "title", end: "today dayGridMonth,listMonth prev,next" }}
        timeZone="Asia/Kuala_Lumpur"
        firstDay={1}
        height="auto"
        dayMaxEvents={3}
        events={entries.map((e) => ({
          id: e.id,
          title: `${formatRM(e.amount)} ${e.title}`,
          start: e.date,
          allDay: true,
          color: e.projected ? "transparent" : e.color,
          textColor: e.projected ? e.color : "#ffffff",
          borderColor: e.color,
          extendedProps: { projected: e.projected },
        }))}
        eventClick={(info) => {
          info.jsEvent.preventDefault();
          if (!info.event.extendedProps.projected) onSelect(info.event.id);
        }}
      />
    </div>
  );
}
