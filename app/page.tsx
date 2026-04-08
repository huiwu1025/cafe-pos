"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type SessionInfo = {
  sessionId: string;
  sessionNumber: string;
  guestCount: number;
  paymentStatus: string;
  seatCodes: string[];
};

type ReservationInfo = {
  reservationId: string;
  reservationCode: string;
  reservationName: string;
  reservationPhone: string;
  reservationDate: string;
  reservationTime: string;
  guestCount: number;
  notes: string;
  seatCodes: string[];
};

type OccupiedSeatMap = Record<string, SessionInfo>;
type ReservedSeatMap = Record<string, ReservationInfo>;

type DashboardSummary = {
  revenue: number;
  guests: number;
  orderCount: number;
  unpaidCount: number;
};

type SeatRow = {
  id: string;
  seat_code: string;
};

const TABLES = ["E", "D", "C", "B"];
const BAR_SEATS = ["A7", "A6", "A5", "A4", "A3", "A2", "A1"];
const RESERVATION_TIMES = [
  "13:00",
  "13:30",
  "14:00",
  "14:30",
  "15:00",
  "15:30",
  "16:00",
  "16:30",
  "17:00",
  "17:30",
  "18:00",
];

function sortSeatCodes(a: string, b: string) {
  const aIsBar = a.startsWith("A");
  const bIsBar = b.startsWith("A");

  if (aIsBar && bIsBar) {
    return Number(a.replace("A", "")) - Number(b.replace("A", ""));
  }

  return a.localeCompare(b);
}

function buildReservationLabel(name: string, phone: string) {
  const normalizedName = name.trim();
  const normalizedPhone = phone.trim();

  if (!normalizedName && !normalizedPhone) return "";
  if (!normalizedPhone) return normalizedName;
  if (!normalizedName) return normalizedPhone;

  return `${normalizedName} | ${normalizedPhone}`;
}

function formatSeatLabel(seatCodes: string[]) {
  const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
  if (isAllBar) return seatCodes.join("、");
  return seatCodes.map((seat) => `${seat}桌`).join("、");
}

function normalizeTimeLabel(value: string) {
  return value.slice(0, 5);
}

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function Home() {
  const router = useRouter();
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [guestCount, setGuestCount] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingReservation, setIsCreatingReservation] = useState(false);
  const [isConvertingReservation, setIsConvertingReservation] = useState(false);
  const [isLoadingOccupied, setIsLoadingOccupied] = useState(true);
  const [occupiedSeats, setOccupiedSeats] = useState<OccupiedSeatMap>({});
  const [reservedSeats, setReservedSeats] = useState<ReservedSeatMap>({});
  const [viewingSession, setViewingSession] = useState<SessionInfo | null>(null);
  const [viewingReservation, setViewingReservation] = useState<ReservationInfo | null>(null);
  const [panelMode, setPanelMode] = useState<"walkin" | "reservation">("walkin");
  const [reservationName, setReservationName] = useState("");
  const [reservationPhone, setReservationPhone] = useState("");
  const [reservationDate, setReservationDate] = useState(todayIsoDate());
  const [reservationTime, setReservationTime] = useState("13:00");
  const [reservationNotes, setReservationNotes] = useState("");
  const [summary, setSummary] = useState<DashboardSummary>({
    revenue: 0,
    guests: 0,
    orderCount: 0,
    unpaidCount: 0,
  });

  const isBarSelection = useMemo(() => {
    return selectedSeats.length > 0 && selectedSeats.every((seat) => seat.startsWith("A"));
  }, [selectedSeats]);

  const selectedLabel = useMemo(() => {
    if (selectedSeats.length === 0) return "尚未選擇";
    if (isBarSelection) return selectedSeats.join("、");
    return `${selectedSeats[0]}桌`;
  }, [isBarSelection, selectedSeats]);

  const seatType = useMemo(() => {
    if (selectedSeats.length === 0) return "未選擇";
    return isBarSelection ? "吧檯座位" : "桌位";
  }, [isBarSelection, selectedSeats.length]);

  const guestLimit = isBarSelection
    ? selectedSeats.length || 1
    : selectedSeats[0] === "B"
      ? 4
      : selectedSeats[0] === "E"
        ? 1
        : 2;

  const statItems = [
    { label: "今日營業額", value: `$${summary.revenue}`, tone: "text-emerald-700" },
    { label: "今日來客數", value: `${summary.guests} 人`, tone: "text-sky-700" },
    { label: "今日訂單數", value: `${summary.orderCount} 張`, tone: "text-violet-700" },
    { label: "未結帳單數", value: `${summary.unpaidCount} 張`, tone: "text-rose-700" },
  ];

  const todayReservations = useMemo(() => {
    const deduped = new Map<string, ReservationInfo>();

    for (const reservation of Object.values(reservedSeats)) {
      deduped.set(reservation.reservationId, reservation);
    }

    return Array.from(deduped.values()).sort((a, b) => {
      const timeCompare = a.reservationTime.localeCompare(b.reservationTime);
      if (timeCompare !== 0) return timeCompare;
      return a.reservationName.localeCompare(b.reservationName);
    });
  }, [reservedSeats]);

  const loadTodaySummary = useCallback(async () => {
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const { data, error } = await supabase
        .from("dining_sessions")
        .select("*")
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString());

      if (error) throw error;

      const rows = data ?? [];
      setSummary({
        revenue: rows
          .filter((row) => row.payment_status === "paid")
          .reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0),
        guests: rows.reduce((sum, row) => sum + Number(row.guest_count ?? 0), 0),
        orderCount: rows.length,
        unpaidCount: rows.filter(
          (row) => row.order_status === "open" && row.payment_status === "unpaid"
        ).length,
      });
    } catch (error) {
      console.error("Failed to load today summary", error);
    }
  }, []);

  const loadOccupiedSeats = useCallback(async () => {
    try {
      setIsLoadingOccupied(true);
      const { data, error } = await supabase
        .from("session_seats")
        .select(`
          session_id,
          seats:seat_id (
            seat_code
          ),
          dining_sessions:session_id (
            id,
            session_number,
            guest_count,
            order_status,
            payment_status
          )
        `);

      if (error) throw error;

      const nextOccupiedSeats: OccupiedSeatMap = {};
      const sessionMap = new Map<string, SessionInfo>();

      for (const row of data ?? []) {
        const session = Array.isArray(row.dining_sessions)
          ? row.dining_sessions[0]
          : row.dining_sessions;
        const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;

        if (
          !session?.id ||
          !seat?.seat_code ||
          session.order_status !== "open" ||
          session.payment_status !== "unpaid"
        ) {
          continue;
        }

        const existing = sessionMap.get(session.id);

        if (existing) {
          if (!existing.seatCodes.includes(seat.seat_code)) {
            existing.seatCodes.push(seat.seat_code);
          }
        } else {
          sessionMap.set(session.id, {
            sessionId: session.id,
            sessionNumber: session.session_number,
            guestCount: Number(session.guest_count ?? 0),
            paymentStatus: session.payment_status,
            seatCodes: [seat.seat_code],
          });
        }
      }

      for (const sessionInfo of sessionMap.values()) {
        sessionInfo.seatCodes.sort(sortSeatCodes);
        for (const seatCode of sessionInfo.seatCodes) {
          nextOccupiedSeats[seatCode] = sessionInfo;
        }
      }

      setOccupiedSeats(nextOccupiedSeats);
    } catch (error) {
      console.error("Failed to load occupied seats", error);
      alert("讀取使用中座位失敗，請查看 console。");
    } finally {
      setIsLoadingOccupied(false);
    }
  }, []);

  const loadReservedSeats = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("reservation_seats")
        .select(`
          reservation_id,
          seats:seat_id (
            seat_code
          ),
          reservations:reservation_id (
            id,
            reservation_code,
            reservation_name,
            reservation_phone,
            reservation_date,
            reservation_time,
            guest_count,
            notes,
            status
          )
        `);

      if (error) {
        const message = String(error.message ?? "");
        if (
          message.includes("reservation_seats") ||
          message.includes("reservations") ||
          message.includes("Could not find")
        ) {
          setReservedSeats({});
          return;
        }
        throw error;
      }

      const today = todayIsoDate();
      const nextReservedSeats: ReservedSeatMap = {};
      const reservationMap = new Map<string, ReservationInfo>();

      for (const row of data ?? []) {
        const reservation = Array.isArray(row.reservations)
          ? row.reservations[0]
          : row.reservations;
        const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;

        if (
          !reservation?.id ||
          !seat?.seat_code ||
          reservation.status !== "reserved" ||
          reservation.reservation_date !== today
        ) {
          continue;
        }

        const existing = reservationMap.get(reservation.id);

        if (existing) {
          if (!existing.seatCodes.includes(seat.seat_code)) {
            existing.seatCodes.push(seat.seat_code);
          }
        } else {
          reservationMap.set(reservation.id, {
            reservationId: reservation.id,
            reservationCode: reservation.reservation_code,
            reservationName: reservation.reservation_name,
            reservationPhone: reservation.reservation_phone,
            reservationDate: reservation.reservation_date,
            reservationTime: normalizeTimeLabel(reservation.reservation_time),
            guestCount: Number(reservation.guest_count ?? 0),
            notes: reservation.notes ?? "",
            seatCodes: [seat.seat_code],
          });
        }
      }

      for (const reservationInfo of reservationMap.values()) {
        reservationInfo.seatCodes.sort(sortSeatCodes);
        for (const seatCode of reservationInfo.seatCodes) {
          nextReservedSeats[seatCode] = reservationInfo;
        }
      }

      setReservedSeats(nextReservedSeats);
    } catch (error) {
      console.error("Failed to load reserved seats", error);
    }
  }, []);

  useEffect(() => {
    loadOccupiedSeats();
    loadReservedSeats();
    loadTodaySummary();
  }, [loadOccupiedSeats, loadReservedSeats, loadTodaySummary]);

  function resetPanelState() {
    setSelectedSeats([]);
    setGuestCount(1);
    setViewingSession(null);
    setViewingReservation(null);
  }

  function resetReservationForm() {
    setReservationName("");
    setReservationPhone("");
    setReservationDate(todayIsoDate());
    setReservationTime("13:00");
    setReservationNotes("");
  }

  function getOccupiedSessionBySeat(seatCode: string) {
    return occupiedSeats[seatCode] ?? null;
  }

  function getReservedSeatBySeat(seatCode: string) {
    return reservedSeats[seatCode] ?? null;
  }

  function isSeatOccupied(seatCode: string) {
    return Boolean(getOccupiedSessionBySeat(seatCode));
  }

  function isSeatReserved(seatCode: string) {
    return Boolean(getReservedSeatBySeat(seatCode));
  }

  function setViewingReservationState(reservation: ReservationInfo) {
    setViewingReservation(reservation);
    setViewingSession(null);
    setSelectedSeats([]);
    setPanelMode("reservation");
  }

  function setSelectedSeatState(seats: string[], nextGuestCount: number) {
    setViewingReservation(null);
    setViewingSession(null);
    setSelectedSeats(seats);
    setGuestCount(nextGuestCount);
  }

  function handleSelectTable(table: string) {
    const occupiedSession = getOccupiedSessionBySeat(table);
    const reservedReservation = getReservedSeatBySeat(table);

    if (occupiedSession) {
      setViewingSession(occupiedSession);
      setViewingReservation(null);
      setSelectedSeats([]);
      return;
    }

    if (reservedReservation) {
      setViewingReservationState(reservedReservation);
      return;
    }

    setSelectedSeatState([table], table === "E" ? 1 : 2);
  }

  function handleSelectBarSeat(seat: string) {
    const occupiedSession = getOccupiedSessionBySeat(seat);
    const reservedReservation = getReservedSeatBySeat(seat);

    if (occupiedSession) {
      setViewingSession(occupiedSession);
      setViewingReservation(null);
      setSelectedSeats([]);
      return;
    }

    if (reservedReservation) {
      setViewingReservationState(reservedReservation);
      return;
    }

    setViewingReservation(null);
    setViewingSession(null);
    setSelectedSeats((prev) => {
      const currentBarSeats = prev.filter((item) => item.startsWith("A"));
      const nextSeats = currentBarSeats.includes(seat)
        ? currentBarSeats.filter((item) => item !== seat)
        : [...currentBarSeats, seat];

      nextSeats.sort(sortSeatCodes);
      setGuestCount(nextSeats.length === 0 ? 1 : nextSeats.length);
      return nextSeats;
    });
  }

  function generateSessionNumber() {
    const now = new Date();
    return `S${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
      now.getDate()
    ).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(
      now.getMinutes()
    ).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  }

  async function fetchSeatRows(seatCodes: string[]) {
    const { data, error } = await supabase.from("seats").select("id, seat_code").in("seat_code", seatCodes);

    if (error) throw error;
    if (!data || data.length === 0) throw new Error("找不到對應座位資料");
    return data as SeatRow[];
  }

  async function handleCreateOrder() {
    if (selectedSeats.length === 0) {
      alert("請先選擇座位");
      return;
    }

    if (selectedSeats.some((seat) => isSeatOccupied(seat) || isSeatReserved(seat))) {
      alert("選取座位中包含使用中或預約保留座位，請重新選擇。");
      return;
    }

    try {
      setIsCreating(true);
      const sessionNumber = generateSessionNumber();

      const { data: sessionData, error: sessionError } = await supabase
        .from("dining_sessions")
        .insert({
          session_number: sessionNumber,
          guest_count: guestCount,
          order_status: "open",
          payment_status: "unpaid",
          payment_method: "現金",
          subtotal_amount: 0,
          discount_amount: 0,
          total_amount: 0,
          customer_type: "客人",
          customer_label: "",
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      const seatRows = await fetchSeatRows(selectedSeats);

      const { error: sessionSeatsError } = await supabase.from("session_seats").insert(
        seatRows.map((seat) => ({
          session_id: sessionData.id,
          seat_id: seat.id,
        }))
      );

      if (sessionSeatsError) throw sessionSeatsError;

      resetPanelState();
      await Promise.all([loadOccupiedSeats(), loadReservedSeats(), loadTodaySummary()]);
      router.push(`/session/${sessionData.id}`);
    } catch (error) {
      console.error("Failed to create session", error);
      alert("建立新單失敗，請查看 console。");
    } finally {
      setIsCreating(false);
    }
  }

  async function handleCreateReservation() {
    if (selectedSeats.length === 0) {
      alert("請先選擇要保留的座位");
      return;
    }

    if (!reservationName.trim() || !reservationPhone.trim()) {
      alert("請輸入預約姓名與電話");
      return;
    }

    if (selectedSeats.some((seat) => isSeatOccupied(seat) || isSeatReserved(seat))) {
      alert("選取座位中已有使用中或保留中的座位");
      return;
    }

    try {
      setIsCreatingReservation(true);

      const { data: reservationData, error: reservationError } = await supabase
        .from("reservations")
        .insert({
          reservation_name: reservationName.trim(),
          reservation_phone: reservationPhone.trim(),
          reservation_date: reservationDate,
          reservation_time: reservationTime,
          guest_count: guestCount,
          status: "reserved",
          notes: reservationNotes.trim(),
        })
        .select()
        .single();

      if (reservationError) throw reservationError;

      const seatRows = await fetchSeatRows(selectedSeats);

      const { error: reservationSeatsError } = await supabase.from("reservation_seats").insert(
        seatRows.map((seat) => ({
          reservation_id: reservationData.id,
          seat_id: seat.id,
        }))
      );

      if (reservationSeatsError) throw reservationSeatsError;

      const nextReservation: ReservationInfo = {
        reservationId: reservationData.id,
        reservationCode: reservationData.reservation_code,
        reservationName: reservationData.reservation_name,
        reservationPhone: reservationData.reservation_phone,
        reservationDate: reservationData.reservation_date,
        reservationTime: normalizeTimeLabel(reservationData.reservation_time),
        guestCount: Number(reservationData.guest_count ?? guestCount),
        notes: reservationData.notes ?? "",
        seatCodes: [...selectedSeats].sort(sortSeatCodes),
      };

      setViewingReservation(nextReservation);
      setViewingSession(null);
      setSelectedSeats([]);
      resetReservationForm();
      await loadReservedSeats();
      alert("預約已建立，座位已保留。");
    } catch (error) {
      console.error("Failed to create reservation", error);
      alert("建立預約失敗，請確認已先執行 reservations SQL。");
    } finally {
      setIsCreatingReservation(false);
    }
  }

  async function handleConvertReservationToSession() {
    if (!viewingReservation) return;

    try {
      setIsConvertingReservation(true);

      const sessionNumber = generateSessionNumber();
      const { data: sessionData, error: sessionError } = await supabase
        .from("dining_sessions")
        .insert({
          session_number: sessionNumber,
          guest_count: viewingReservation.guestCount,
          order_status: "open",
          payment_status: "unpaid",
          payment_method: "現金",
          subtotal_amount: 0,
          discount_amount: 0,
          total_amount: 0,
          customer_type: "客人",
          customer_label: buildReservationLabel(
            viewingReservation.reservationName,
            viewingReservation.reservationPhone
          ),
        })
        .select()
        .single();

      if (sessionError) throw sessionError;

      const seatRows = await fetchSeatRows(viewingReservation.seatCodes);

      const { error: sessionSeatsError } = await supabase.from("session_seats").insert(
        seatRows.map((seat) => ({
          session_id: sessionData.id,
          seat_id: seat.id,
        }))
      );

      if (sessionSeatsError) throw sessionSeatsError;

      const { error: reservationUpdateError } = await supabase
        .from("reservations")
        .update({
          status: "arrived",
          converted_session_id: sessionData.id,
        })
        .eq("id", viewingReservation.reservationId);

      if (reservationUpdateError) throw reservationUpdateError;

      resetPanelState();
      await Promise.all([loadOccupiedSeats(), loadReservedSeats(), loadTodaySummary()]);
      router.push(`/session/${sessionData.id}`);
    } catch (error) {
      console.error("Failed to convert reservation", error);
      alert("預約轉開單失敗，請查看 console。");
    } finally {
      setIsConvertingReservation(false);
    }
  }

  async function updateReservationStatus(
    reservation: ReservationInfo,
    status: "cancelled" | "no_show"
  ) {
    const statusLabel = status === "cancelled" ? "取消預約" : "標記逾時";
    const confirmed = window.confirm(`確定要${statusLabel}嗎？`);

    if (!confirmed) return;

    try {
      const { error } = await supabase
        .from("reservations")
        .update({
          status,
        })
        .eq("id", reservation.reservationId);

      if (error) throw error;

      if (viewingReservation?.reservationId === reservation.reservationId) {
        setViewingReservation(null);
      }

      await loadReservedSeats();
    } catch (error) {
      console.error("Failed to update reservation status", error);
      alert(`${statusLabel}失敗，請查看 console。`);
    }
  }

  function seatClass(seat: string, variant: "table" | "bar") {
    const selected = selectedSeats.includes(seat);
    const viewing = viewingSession?.seatCodes.includes(seat);
    const reservedViewing = viewingReservation?.seatCodes.includes(seat);
    const occupied = isSeatOccupied(seat);
    const reserved = isSeatReserved(seat);
    const height = variant === "table" ? "h-[92px] lg:h-[104px]" : "h-[82px] lg:h-[92px]";
    const base =
      `${height} rounded-[22px] border px-3 py-2 text-center shadow-sm transition ` +
      "active:scale-[0.99] disabled:opacity-70";

    if (viewing) return `${base} border-sky-200 bg-sky-500 text-white`;
    if (occupied) return `${base} border-rose-200 bg-rose-500 text-white`;
    if (reservedViewing) return `${base} border-fuchsia-200 bg-fuchsia-500 text-white`;
    if (reserved) return `${base} border-fuchsia-200 bg-fuchsia-100 text-fuchsia-900`;
    if (selected) return `${base} border-amber-200 bg-amber-300 text-slate-900`;
    return `${base} border-slate-200 bg-white text-slate-900 hover:bg-amber-50`;
  }

  return (
    <main className="pos-shell p-3 md:p-4">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-3">
        <header className="pos-panel rounded-[28px] px-4 py-3 lg:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">
                Cafe POS
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">座位主控台</h1>
                <p className="text-sm text-slate-500">把主要空間留給座位與預約操作</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:flex lg:shrink-0">
              <button
                onClick={() => router.push("/orders")}
                className="h-11 rounded-2xl bg-sky-100 px-4 text-sm font-semibold text-sky-900 hover:bg-sky-200"
              >
                歷史訂單
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="h-11 rounded-2xl bg-emerald-100 px-4 text-sm font-semibold text-emerald-900 hover:bg-emerald-200"
              >
                今日後台
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-2 lg:gap-3">
            {statItems.map((item) => (
              <div key={item.label} className="rounded-[20px] bg-slate-50 px-3 py-3">
                <p className="text-[11px] text-slate-500 lg:text-xs">{item.label}</p>
                <p className={`mt-1 text-xl font-bold lg:text-2xl ${item.tone}`}>{item.value}</p>
              </div>
            ))}
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_340px]">
          <section className="pos-panel min-h-0 rounded-[28px] p-3 lg:p-4">
            <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm text-slate-500">目前狀態</p>
                <h2 className="mt-1 text-2xl font-bold text-slate-900 lg:text-3xl">
                  {viewingSession
                    ? `查看中 ${formatSeatLabel(viewingSession.seatCodes)}`
                    : viewingReservation
                      ? `預約中 ${formatSeatLabel(viewingReservation.seatCodes)}`
                      : selectedLabel}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-rose-100 px-3 py-1.5 font-semibold text-rose-700">
                  紅色 = 使用中
                </span>
                <span className="rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-800">
                  黃色 = 目前選取
                </span>
                <span className="rounded-full bg-sky-100 px-3 py-1.5 font-semibold text-sky-800">
                  藍色 = 查看中
                </span>
                <span className="rounded-full bg-fuchsia-100 px-3 py-1.5 font-semibold text-fuchsia-800">
                  紫色 = 預約保留
                </span>
              </div>
            </div>

            <div className="grid h-[calc(100%-5.25rem)] min-h-0 gap-3 lg:grid-rows-[auto_minmax(0,1fr)]">
              <section className="rounded-[24px] bg-slate-50 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">桌位區</h3>
                    <p className="text-xs text-slate-500">單選開單</p>
                  </div>
                  <span className="text-xs text-slate-500">4 桌</span>
                </div>
                <div className="grid grid-cols-4 gap-2 lg:gap-3">
                  {TABLES.map((table) => {
                    const occupied = getOccupiedSessionBySeat(table);
                    const reserved = getReservedSeatBySeat(table);

                    return (
                      <button
                        key={table}
                        type="button"
                        onClick={() => handleSelectTable(table)}
                        disabled={isLoadingOccupied}
                        className={seatClass(table, "table")}
                      >
                        <div>
                          <p className="text-2xl font-bold lg:text-[28px]">{table}桌</p>
                          <p className="mt-1 text-xs font-medium opacity-90">
                            {viewingSession?.seatCodes.includes(table)
                              ? "查看中"
                              : occupied
                                ? "使用中"
                                : reserved
                                  ? `${reserved.reservationTime} 預約`
                                  : "可開單"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="min-h-0 rounded-[24px] bg-slate-50 p-3">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900">吧檯座位</h3>
                    <p className="text-xs text-slate-500">可複選開單</p>
                  </div>
                  <span className="text-xs text-slate-500">7 位</span>
                </div>
                <div className="grid grid-cols-4 gap-2 lg:grid-cols-7 lg:gap-3">
                  {BAR_SEATS.map((seat) => {
                    const occupied = getOccupiedSessionBySeat(seat);
                    const reserved = getReservedSeatBySeat(seat);

                    return (
                      <button
                        key={seat}
                        type="button"
                        onClick={() => handleSelectBarSeat(seat)}
                        disabled={isLoadingOccupied}
                        className={seatClass(seat, "bar")}
                      >
                        <div>
                          <p className="text-lg font-bold lg:text-xl">{seat}</p>
                          <p className="mt-1 text-[11px] font-medium opacity-90">
                            {viewingSession?.seatCodes.includes(seat)
                              ? "查看中"
                              : occupied
                                ? "使用中"
                                : reserved
                                  ? `${reserved.reservationTime} 預約`
                                  : "可開單"}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          </section>
          <aside className="grid min-h-0 gap-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:grid-rows-[minmax(0,1fr)_auto_220px]">
            <section className="pos-panel flex min-h-0 flex-col overflow-hidden rounded-[28px] p-3 lg:p-4">
              {viewingSession ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-500">使用中座位</p>
                      <h2 className="mt-1 text-2xl font-bold text-slate-900">現場訂單</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewingSession(null)}
                      className="h-10 rounded-2xl bg-slate-100 px-3 text-sm font-semibold text-slate-700"
                    >
                      關閉
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    <AsideCard label="主單編號" value={viewingSession.sessionNumber} />
                    <AsideCard label="座位" value={formatSeatLabel(viewingSession.seatCodes)} />
                    <div className="grid grid-cols-2 gap-2">
                      <AsideCard label="來客數" value={`${viewingSession.guestCount} 人`} />
                      <AsideCard label="付款狀態" value={viewingSession.paymentStatus} />
                    </div>
                    <button
                      onClick={() => router.push(`/session/${viewingSession.sessionId}`)}
                      className="h-14 w-full rounded-[22px] bg-sky-500 text-lg font-bold text-white hover:bg-sky-600"
                    >
                      進入主單
                    </button>
                  </div>
                </>
              ) : viewingReservation ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-500">預約座位</p>
                      <h2 className="mt-1 text-2xl font-bold text-slate-900">預約保留</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewingReservation(null)}
                      className="h-10 rounded-2xl bg-slate-100 px-3 text-sm font-semibold text-slate-700"
                    >
                      關閉
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    <AsideCard label="預約編號" value={viewingReservation.reservationCode} />
                    <AsideCard label="預約姓名" value={viewingReservation.reservationName} />
                    <AsideCard label="預約電話" value={viewingReservation.reservationPhone} />
                    <div className="grid grid-cols-2 gap-2">
                      <AsideCard label="時間" value={viewingReservation.reservationTime} />
                      <AsideCard label="來客數" value={`${viewingReservation.guestCount} 人`} />
                    </div>
                    <AsideCard label="座位" value={formatSeatLabel(viewingReservation.seatCodes)} />
                    <AsideCard label="備註" value={viewingReservation.notes || "無"} />
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => updateReservationStatus(viewingReservation, "cancelled")}
                        className="h-11 rounded-[20px] bg-rose-100 px-3 text-sm font-semibold text-rose-800 hover:bg-rose-200"
                      >
                        取消預約
                      </button>
                      <button
                        type="button"
                        onClick={() => updateReservationStatus(viewingReservation, "no_show")}
                        className="h-11 rounded-[20px] bg-slate-200 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-300"
                      >
                        標記逾時
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={handleConvertReservationToSession}
                      disabled={isConvertingReservation}
                      className="h-14 w-full rounded-[22px] bg-emerald-500 text-lg font-bold text-white hover:bg-emerald-600 disabled:opacity-60"
                    >
                      {isConvertingReservation ? "轉單中..." : "客到轉開單"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-500">右側工作區</p>
                      <h2 className="mt-1 text-2xl font-bold text-slate-900">
                        {panelMode === "walkin" ? "新單設定" : "預約保留"}
                      </h2>
                      <p className="mt-1 text-xs text-slate-500">
                        先選座位，再決定是現場開單還是預約保留
                      </p>
                    </div>
                    {(selectedSeats.length > 0 || reservationName || reservationPhone || reservationNotes) && (
                      <button
                        type="button"
                        onClick={() => {
                          resetPanelState();
                          resetReservationForm();
                        }}
                        className="h-10 rounded-2xl bg-slate-100 px-3 text-sm font-semibold text-slate-700"
                      >
                        清空
                      </button>
                    )}
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPanelMode("walkin")}
                      className={`h-11 rounded-2xl text-sm font-semibold ${
                        panelMode === "walkin"
                          ? "bg-amber-300 text-slate-900"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      現場開單
                    </button>
                    <button
                      type="button"
                      onClick={() => setPanelMode("reservation")}
                      className={`h-11 rounded-2xl text-sm font-semibold ${
                        panelMode === "reservation"
                          ? "bg-fuchsia-200 text-fuchsia-900"
                          : "bg-slate-100 text-slate-700"
                      }`}
                    >
                      建立預約
                    </button>
                  </div>

                  <div className="mt-3 space-y-3">
                    <AsideCard label="目前座位" value={selectedLabel} />
                    <AsideCard label="座位類型" value={seatType} />
                    <div className="rounded-[22px] bg-slate-50 p-3">
                      <label htmlFor="guestCount" className="text-sm text-slate-500">
                        來客數
                      </label>
                      <input
                        id="guestCount"
                        type="number"
                        min={1}
                        max={guestLimit}
                        value={guestCount}
                        onChange={(e) =>
                          setGuestCount(Math.max(1, Math.min(guestLimit, Number(e.target.value) || 1)))
                        }
                        disabled={selectedSeats.length === 0}
                        className="mt-2 h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-xl font-bold text-slate-900 outline-none focus:border-amber-400 disabled:bg-slate-100"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        {selectedSeats.length === 0 && "請先選擇座位"}
                        {isBarSelection && `吧檯依選取座位數計算，最多 ${selectedSeats.length} 人`}
                        {selectedSeats[0] === "B" && "B 桌可輸入 2 到 4 人"}
                        {(selectedSeats[0] === "C" || selectedSeats[0] === "D") &&
                          "C / D 桌建議 2 人"}
                        {selectedSeats[0] === "E" && "E 桌為單人座"}
                      </p>
                    </div>

                    {panelMode === "reservation" && (
                      <div className="space-y-3 rounded-[24px] bg-slate-50 p-3">
                        <InputField
                          id="reservationName"
                          label="預約姓名"
                          value={reservationName}
                          onChange={setReservationName}
                          placeholder="例如：王小美"
                        />
                        <InputField
                          id="reservationPhone"
                          label="預約電話"
                          value={reservationPhone}
                          onChange={setReservationPhone}
                          placeholder="例如：0912345678"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <InputField
                            id="reservationDate"
                            label="日期"
                            type="date"
                            value={reservationDate}
                            onChange={setReservationDate}
                          />
                          <SelectField
                            id="reservationTime"
                            label="時間"
                            value={reservationTime}
                            onChange={setReservationTime}
                            options={RESERVATION_TIMES}
                          />
                        </div>
                        <InputField
                          id="reservationNotes"
                          label="備註"
                          value={reservationNotes}
                          onChange={setReservationNotes}
                          placeholder="例如：13:30 到店、靠窗、帶小孩"
                        />
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>

            {!viewingSession && !viewingReservation && (
              <section className="pos-panel rounded-[28px] p-3">
                {panelMode === "walkin" ? (
                  <button
                    type="button"
                    onClick={handleCreateOrder}
                    disabled={selectedSeats.length === 0 || isCreating || isLoadingOccupied}
                    className="h-14 w-full rounded-[22px] bg-amber-400 text-lg font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-50"
                  >
                    {isCreating ? "建立中..." : "建立新單"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCreateReservation}
                    disabled={
                      selectedSeats.length === 0 ||
                      isCreatingReservation ||
                      !reservationName.trim() ||
                      !reservationPhone.trim()
                    }
                    className="h-14 w-full rounded-[22px] bg-fuchsia-500 text-lg font-bold text-white hover:bg-fuchsia-600 disabled:opacity-50"
                  >
                    {isCreatingReservation ? "預約建立中..." : "建立預約並鎖位"}
                  </button>
                )}
              </section>
            )}

            <section className="pos-panel flex min-h-0 flex-col overflow-hidden rounded-[28px] p-3">
              <div className="mb-3 flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">今日預約列表</h3>
                  <p className="text-xs text-slate-500">可直接查看、取消或標記逾時</p>
                </div>
                <span className="rounded-full bg-fuchsia-100 px-3 py-1 text-xs font-semibold text-fuchsia-800">
                  {todayReservations.length} 筆
                </span>
              </div>

              <div className="pos-scroll min-h-0 space-y-2 pr-1">
                {todayReservations.length === 0 ? (
                  <div className="rounded-[22px] bg-slate-50 p-4 text-sm text-slate-500">
                    今日尚無預約
                  </div>
                ) : (
                  todayReservations.map((reservation) => (
                    <div
                      key={reservation.reservationId}
                      className={`rounded-[22px] border p-3 ${
                        viewingReservation?.reservationId === reservation.reservationId
                          ? "border-fuchsia-300 bg-fuchsia-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setViewingReservationState(reservation)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900">
                              {reservation.reservationTime} {reservation.reservationName}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {formatSeatLabel(reservation.seatCodes)} / {reservation.guestCount} 人
                            </p>
                            <p className="mt-1 text-xs text-slate-500">{reservation.reservationPhone}</p>
                          </div>
                          <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-slate-600">
                            {reservation.reservationCode}
                          </span>
                        </div>
                      </button>

                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => updateReservationStatus(reservation, "cancelled")}
                          className="h-9 rounded-2xl bg-rose-100 px-3 text-xs font-semibold text-rose-800 hover:bg-rose-200"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          onClick={() => updateReservationStatus(reservation, "no_show")}
                          className="h-9 rounded-2xl bg-slate-200 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-300"
                        >
                          逾時
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}

function AsideCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[22px] bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-900">{value}</p>
    </div>
  );
}

function InputField({
  id,
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-sm text-slate-500">{label}</span>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none focus:border-amber-400"
      />
    </label>
  );
}

function SelectField({
  id,
  label,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <label className="block">
      <span className="text-sm text-slate-500">{label}</span>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none focus:border-amber-400"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
