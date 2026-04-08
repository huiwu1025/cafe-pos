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
  convertedSessionId?: string | null;
};

type DashboardSummary = {
  revenue: number;
  guests: number;
  orderCount: number;
  unpaidCount: number;
};

type BlacklistMatch = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  strike_count: number;
  last_reason: string;
};

type OccupiedSeatMap = Record<string, SessionInfo>;
type ReservedSeatMap = Record<string, ReservationInfo>;

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

function todayIsoDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sortSeatCodes(a: string, b: string) {
  const aIsBar = a.startsWith("A");
  const bIsBar = b.startsWith("A");
  if (aIsBar && bIsBar) return Number(a.replace("A", "")) - Number(b.replace("A", ""));
  return a.localeCompare(b);
}

function formatSeatLabel(seatCodes: string[]) {
  if (seatCodes.length === 0) return "尚未選擇";
  const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
  if (isAllBar) return seatCodes.join("、");
  return seatCodes.map((seat) => `${seat}桌`).join("、");
}

function buildReservationLabel(name: string, phone: string) {
  const normalizedName = name.trim();
  const normalizedPhone = phone.trim();
  if (!normalizedName && !normalizedPhone) return "";
  if (!normalizedPhone) return normalizedName;
  if (!normalizedName) return normalizedPhone;
  return `${normalizedName} | ${normalizedPhone}`;
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

function normalizeTimeLabel(value: string) {
  return String(value).slice(0, 5);
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = String((error as { message?: string }).message ?? "").trim();
    if (message) return message;
  }
  return fallback;
}

async function findBlacklistMatches(name: string, phone: string) {
  const normalizedName = name.trim();
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedName && !normalizedPhone) return [];

  const results = await Promise.all([
    supabase
      .from("blacklist_customers")
      .select("id, customer_name, customer_phone, strike_count, last_reason")
      .limit(200),
    supabase
      .from("reservations")
      .select("id, reservation_name, reservation_phone")
      .eq("status", "no_show")
      .limit(200),
  ]);
  const matches = new Map<string, BlacklistMatch>();

  const [blacklistResult, noShowResult] = results;
  for (const result of [blacklistResult]) {
    const maybeError = result.error as { message?: string } | null;
    if (maybeError?.message?.includes("blacklist_customers")) {
      break;
    }
    if (result.error) throw result.error;
    for (const row of result.data ?? []) {
      const rowName = row.customer_name?.trim() ?? "";
      const rowPhone = normalizePhone(row.customer_phone ?? "");
      if (
        (normalizedPhone && rowPhone === normalizedPhone) ||
        (normalizedName && rowName === normalizedName)
      ) {
        matches.set(row.id, row);
      }
    }
  }

  if (noShowResult.error) throw noShowResult.error;
  for (const row of noShowResult.data ?? []) {
    const rowName = row.reservation_name?.trim() ?? "";
    const rowPhone = normalizePhone(row.reservation_phone ?? "");
    if (
      (normalizedPhone && rowPhone === normalizedPhone) ||
      (normalizedName && rowName === normalizedName)
    ) {
      matches.set(`no-show-${row.id}`, {
        id: `no-show-${row.id}`,
        customer_name: row.reservation_name,
        customer_phone: row.reservation_phone,
        strike_count: 1,
        last_reason: "no_show",
      });
    }
  }

  return Array.from(matches.values());
}

export default function Home() {
  const router = useRouter();
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [guestCount, setGuestCount] = useState(1);
  const [panelMode, setPanelMode] = useState<"walkin" | "reservation">("walkin");
  const [summary, setSummary] = useState<DashboardSummary>({ revenue: 0, guests: 0, orderCount: 0, unpaidCount: 0 });
  const [occupiedSeats, setOccupiedSeats] = useState<OccupiedSeatMap>({});
  const [reservedSeats, setReservedSeats] = useState<ReservedSeatMap>({});
  const [viewingSession, setViewingSession] = useState<SessionInfo | null>(null);
  const [viewingReservation, setViewingReservation] = useState<ReservationInfo | null>(null);
  const [isLoadingSeats, setIsLoadingSeats] = useState(true);
  const [isCreatingOrder, setIsCreatingOrder] = useState(false);
  const [isCreatingReservation, setIsCreatingReservation] = useState(false);
  const [isConvertingReservation, setIsConvertingReservation] = useState(false);
  const [showReservationModal, setShowReservationModal] = useState(false);
  const [reservationName, setReservationName] = useState("");
  const [reservationPhone, setReservationPhone] = useState("");
  const [reservationDate, setReservationDate] = useState(todayIsoDate());
  const [reservationTime, setReservationTime] = useState("13:00");
  const [reservationNotes, setReservationNotes] = useState("");

  const isBarSelection = useMemo(() => selectedSeats.length > 0 && selectedSeats.every((seat) => seat.startsWith("A")), [selectedSeats]);
  const guestLimit = useMemo(() => {
    if (selectedSeats.length === 0) return 1;
    if (isBarSelection) return selectedSeats.length;
    if (selectedSeats[0] === "B") return 4;
    if (selectedSeats[0] === "C" || selectedSeats[0] === "D") return 2;
    return 1;
  }, [isBarSelection, selectedSeats]);
  const selectedLabel = useMemo(() => formatSeatLabel(selectedSeats), [selectedSeats]);
  const seatType = useMemo(() => (selectedSeats.length === 0 ? "未選擇" : isBarSelection ? "吧檯座位" : "桌位"), [isBarSelection, selectedSeats]);
  const statItems = [
    { label: "今日營業額", value: `$${summary.revenue}`, tone: "text-emerald-700" },
    { label: "今日來客數", value: `${summary.guests} 人`, tone: "text-sky-700" },
    { label: "今日訂單數", value: `${summary.orderCount} 張`, tone: "text-violet-700" },
    { label: "未結帳單數", value: `${summary.unpaidCount} 張`, tone: "text-rose-700" },
  ];

  const loadTodaySummary = useCallback(async () => {
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      const { data, error } = await supabase.from("dining_sessions").select("*").gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
      if (error) throw error;
      const rows = data ?? [];
      setSummary({
        revenue: rows.filter((row) => row.payment_status === "paid").reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0),
        guests: rows.reduce((sum, row) => sum + Number(row.guest_count ?? 0), 0),
        orderCount: rows.length,
        unpaidCount: rows.filter((row) => row.order_status === "open" && row.payment_status === "unpaid").length,
      });
    } catch (error) {
      console.error("Failed to load today summary", error);
    }
  }, []);

  const loadOccupiedSeats = useCallback(async () => {
    try {
      setIsLoadingSeats(true);
      const { data, error } = await supabase.from("session_seats").select(`
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
      const nextMap: OccupiedSeatMap = {};
      const sessionMap = new Map<string, SessionInfo>();
      for (const row of data ?? []) {
        const session = Array.isArray(row.dining_sessions) ? row.dining_sessions[0] : row.dining_sessions;
        const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
        if (!session?.id || !seat?.seat_code || session.order_status !== "open" || session.payment_status !== "unpaid") continue;
        const existing = sessionMap.get(session.id);
        if (existing) existing.seatCodes.push(seat.seat_code);
        else sessionMap.set(session.id, { sessionId: session.id, sessionNumber: session.session_number, guestCount: Number(session.guest_count ?? 0), paymentStatus: session.payment_status, seatCodes: [seat.seat_code] });
      }
      for (const sessionInfo of sessionMap.values()) {
        sessionInfo.seatCodes.sort(sortSeatCodes);
        for (const seatCode of sessionInfo.seatCodes) nextMap[seatCode] = sessionInfo;
      }
      setOccupiedSeats(nextMap);
    } catch (error) {
      console.error("Failed to load occupied seats", error);
    } finally {
      setIsLoadingSeats(false);
    }
  }, []);

  const loadReservedSeats = useCallback(async () => {
    try {
      const { data, error } = await supabase.from("reservation_seats").select(`
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
          status,
          converted_session_id
        )
      `);
      if (error) {
        const message = String(error.message ?? "");
        if (message.includes("reservation_seats") || message.includes("reservations") || message.includes("Could not find")) {
          setReservedSeats({});
          return;
        }
        throw error;
      }
      const nextMap: ReservedSeatMap = {};
      const reservationMap = new Map<string, ReservationInfo>();
      const today = todayIsoDate();
      for (const row of data ?? []) {
        const reservation = Array.isArray(row.reservations) ? row.reservations[0] : row.reservations;
        const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
        if (!reservation?.id || !seat?.seat_code || reservation.status !== "reserved" || reservation.reservation_date !== today) continue;
        const existing = reservationMap.get(reservation.id);
        if (existing) existing.seatCodes.push(seat.seat_code);
        else reservationMap.set(reservation.id, { reservationId: reservation.id, reservationCode: reservation.reservation_code, reservationName: reservation.reservation_name, reservationPhone: reservation.reservation_phone, reservationDate: reservation.reservation_date, reservationTime: normalizeTimeLabel(reservation.reservation_time), guestCount: Number(reservation.guest_count ?? 0), notes: reservation.notes ?? "", seatCodes: [seat.seat_code], convertedSessionId: reservation.converted_session_id ?? null });
      }
      for (const reservationInfo of reservationMap.values()) {
        reservationInfo.seatCodes.sort(sortSeatCodes);
        for (const seatCode of reservationInfo.seatCodes) nextMap[seatCode] = reservationInfo;
      }
      setReservedSeats(nextMap);
    } catch (error) {
      console.error("Failed to load reserved seats", error);
    }
  }, []);

  useEffect(() => {
    loadTodaySummary();
    loadOccupiedSeats();
    loadReservedSeats();
  }, [loadOccupiedSeats, loadReservedSeats, loadTodaySummary]);

  useEffect(() => {
    setGuestCount((prev) => Math.max(1, Math.min(prev, guestLimit)));
  }, [guestLimit]);
  function resetSelectionState() {
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

  function isSeatOccupied(seatCode: string) {
    return Boolean(occupiedSeats[seatCode]);
  }

  function isSeatReserved(seatCode: string) {
    return Boolean(reservedSeats[seatCode]);
  }

  function handleSelectTable(seatCode: string) {
    const occupiedSession = occupiedSeats[seatCode];
    const reservedReservation = reservedSeats[seatCode];
    if (occupiedSession) {
      setViewingSession(occupiedSession);
      setViewingReservation(null);
      setSelectedSeats([]);
      return;
    }
    if (reservedReservation) {
      setViewingReservation(reservedReservation);
      setViewingSession(null);
      setSelectedSeats([]);
      return;
    }
    setViewingSession(null);
    setViewingReservation(null);
    setSelectedSeats([seatCode]);
    setGuestCount(1);
  }

  function handleSelectBarSeat(seatCode: string) {
    const occupiedSession = occupiedSeats[seatCode];
    const reservedReservation = reservedSeats[seatCode];
    if (occupiedSession) {
      setViewingSession(occupiedSession);
      setViewingReservation(null);
      setSelectedSeats([]);
      return;
    }
    if (reservedReservation) {
      setViewingReservation(reservedReservation);
      setViewingSession(null);
      setSelectedSeats([]);
      return;
    }
    setViewingSession(null);
    setViewingReservation(null);
    setSelectedSeats((prev) => {
      const barSeats = prev.filter((seat) => seat.startsWith("A"));
      const nextSeats = barSeats.includes(seatCode) ? barSeats.filter((seat) => seat !== seatCode) : [...barSeats, seatCode];
      nextSeats.sort(sortSeatCodes);
      return nextSeats;
    });
  }

  async function fetchSeatRows(seatCodes: string[]) {
    const { data, error } = await supabase.from("seats").select("id, seat_code").in("seat_code", seatCodes);
    if (error) throw error;
    if (!data || data.length === 0) throw new Error("找不到座位資料");
    return data;
  }

  function generateSessionNumber() {
    const now = new Date();
    return `S${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${String(now.getHours()).padStart(2, "0")}${String(now.getMinutes()).padStart(2, "0")}${String(now.getSeconds()).padStart(2, "0")}`;
  }

  async function handleCreateOrder() {
    if (selectedSeats.length === 0) {
      alert("請先選擇座位");
      return;
    }
    if (selectedSeats.some((seat) => isSeatOccupied(seat) || isSeatReserved(seat))) {
      alert("選取座位中包含使用中或預約保留座位");
      return;
    }
    try {
      setIsCreatingOrder(true);
      const { data: sessionData, error: sessionError } = await supabase.from("dining_sessions").insert({
        session_number: generateSessionNumber(),
        guest_count: guestCount,
        order_status: "open",
        payment_status: "unpaid",
        payment_method: "現金",
        subtotal_amount: 0,
        discount_amount: 0,
        total_amount: 0,
        customer_type: "客人",
        customer_label: "",
      }).select().single();
      if (sessionError) throw sessionError;
      const seatRows = await fetchSeatRows(selectedSeats);
      const { error: seatInsertError } = await supabase.from("session_seats").insert(seatRows.map((seat) => ({ session_id: sessionData.id, seat_id: seat.id })));
      if (seatInsertError) throw seatInsertError;
      resetSelectionState();
      await Promise.all([loadTodaySummary(), loadOccupiedSeats(), loadReservedSeats()]);
      router.push(`/session/${sessionData.id}`);
    } catch (error) {
      console.error("Failed to create order", error);
      alert("建立新單失敗");
    } finally {
      setIsCreatingOrder(false);
    }
  }

  function openReservationModal() {
    if (selectedSeats.length === 0) {
      alert("請先選擇要保留的座位");
      return;
    }
    if (selectedSeats.some((seat) => isSeatOccupied(seat) || isSeatReserved(seat))) {
      alert("選取座位中已有使用中或保留中的座位");
      return;
    }
    setShowReservationModal(true);
  }

  async function handleCreateReservation() {
    if (!reservationName.trim() || !reservationPhone.trim()) {
      alert("請輸入預約姓名與電話");
      return;
    }
    try {
      setIsCreatingReservation(true);
      const blacklistMatches = await findBlacklistMatches(reservationName, reservationPhone);
      if (blacklistMatches.length > 0) {
        const labels = blacklistMatches
          .map((item) => `${item.customer_name || "未填姓名"} / ${item.customer_phone || "未填電話"} / ${item.strike_count} 次`)
          .join("\n");
        const proceed = window.confirm(
          `警告：此姓名或電話曾被列入黑名單。\n${labels}\n\n仍要建立這筆預約嗎？`
        );
        if (!proceed) {
          setIsCreatingReservation(false);
          return;
        }
      }
      const { data: reservationData, error: reservationError } = await supabase.from("reservations").insert({
        reservation_name: reservationName.trim(),
        reservation_phone: reservationPhone.trim(),
        reservation_date: reservationDate,
        reservation_time: reservationTime,
        guest_count: guestCount,
        status: "reserved",
        notes: reservationNotes.trim(),
      }).select().single();
      if (reservationError) throw reservationError;
      const seatRows = await fetchSeatRows(selectedSeats);
      const { error: seatInsertError } = await supabase.from("reservation_seats").insert(seatRows.map((seat) => ({ reservation_id: reservationData.id, seat_id: seat.id })));
      if (seatInsertError) throw seatInsertError;
      resetReservationForm();
      setShowReservationModal(false);
      resetSelectionState();
      await loadReservedSeats();
      alert("預約已建立並鎖位");
    } catch (error) {
      console.error("Failed to create reservation", error);
      alert("建立預約失敗，請確認已執行 reservations SQL");
    } finally {
      setIsCreatingReservation(false);
    }
  }

  async function handleConvertReservationToSession() {
    if (!viewingReservation) return;
    try {
      setIsConvertingReservation(true);
      const { data: reservationRow, error: reservationError } = await supabase
        .from("reservations")
        .select("id, reservation_name, reservation_phone, guest_count, status, converted_session_id")
        .eq("id", viewingReservation.reservationId)
        .single();
      if (reservationError) throw reservationError;

      if (reservationRow.converted_session_id) {
        if (reservationRow.status !== "arrived") {
          const { error: updateExistingError } = await supabase
            .from("reservations")
            .update({ status: "arrived" })
            .eq("id", viewingReservation.reservationId);
          if (updateExistingError) throw updateExistingError;
        }
        resetSelectionState();
        await Promise.all([loadTodaySummary(), loadOccupiedSeats(), loadReservedSeats()]);
        router.push(`/session/${reservationRow.converted_session_id}`);
        return;
      }

      const { data: sessionData, error: sessionError } = await supabase.from("dining_sessions").insert({
        session_number: generateSessionNumber(),
        guest_count: Number(reservationRow.guest_count ?? viewingReservation.guestCount ?? 1),
        order_status: "open",
        payment_status: "unpaid",
        payment_method: "現金",
        subtotal_amount: 0,
        discount_amount: 0,
        total_amount: 0,
        customer_type: "客人",
        customer_label: buildReservationLabel(
          reservationRow.reservation_name ?? viewingReservation.reservationName,
          reservationRow.reservation_phone ?? viewingReservation.reservationPhone
        ),
      }).select().single();
      if (sessionError) throw sessionError;
      const seatRows = await fetchSeatRows(viewingReservation.seatCodes);
      const { error: seatInsertError } = await supabase.from("session_seats").insert(seatRows.map((seat) => ({ session_id: sessionData.id, seat_id: seat.id })));
      if (seatInsertError) throw seatInsertError;
      const { error: updateError } = await supabase.from("reservations").update({ status: "arrived", converted_session_id: sessionData.id }).eq("id", viewingReservation.reservationId);
      if (updateError) throw updateError;
      resetSelectionState();
      await Promise.all([loadTodaySummary(), loadOccupiedSeats(), loadReservedSeats()]);
      router.push(`/session/${sessionData.id}`);
    } catch (error) {
      console.error("Failed to convert reservation", error);
      alert(`預約轉開單失敗：${getErrorMessage(error, "請稍後再試")}`);
    } finally {
      setIsConvertingReservation(false);
    }
  }

  async function updateReservationStatus(reservation: ReservationInfo, status: "cancelled" | "no_show") {
    const confirmed = window.confirm(status === "cancelled" ? "確定取消這筆預約？" : "確定將這筆預約標記為逾時？");
    if (!confirmed) return;
    try {
      const { error } = await supabase.from("reservations").update({ status }).eq("id", reservation.reservationId);
      if (error) throw error;
      if (viewingReservation?.reservationId === reservation.reservationId) setViewingReservation(null);
      await loadReservedSeats();
    } catch (error) {
      console.error("Failed to update reservation status", error);
      alert("更新預約狀態失敗");
    }
  }

  function seatClass(seatCode: string, variant: "table" | "bar") {
    const isSelected = selectedSeats.includes(seatCode);
    const isViewingSession = viewingSession?.seatCodes.includes(seatCode);
    const isViewingReservation = viewingReservation?.seatCodes.includes(seatCode);
    const occupied = isSeatOccupied(seatCode);
    const reserved = isSeatReserved(seatCode);
    const height = variant === "table" ? "h-[92px] lg:h-[104px]" : "h-[82px] lg:h-[92px]";
    const base = `${height} rounded-[22px] border px-3 py-2 text-center shadow-sm transition active:scale-[0.99] disabled:opacity-70`;
    if (isViewingSession) return `${base} border-sky-200 bg-sky-500 text-white`;
    if (occupied) return `${base} border-rose-200 bg-rose-500 text-white`;
    if (isViewingReservation) return `${base} border-fuchsia-200 bg-fuchsia-500 text-white`;
    if (reserved) return `${base} border-fuchsia-200 bg-fuchsia-100 text-fuchsia-900`;
    if (isSelected) return `${base} border-amber-200 bg-amber-300 text-slate-900`;
    return `${base} border-slate-200 bg-white text-slate-900 hover:bg-amber-50`;
  }

  function seatStatusLabel(seatCode: string) {
    if (viewingSession?.seatCodes.includes(seatCode)) return "查看中";
    if (viewingReservation?.seatCodes.includes(seatCode)) return "預約中";
    if (isSeatOccupied(seatCode)) return "使用中";
    const reservation = reservedSeats[seatCode];
    if (reservation) return `${reservation.reservationTime} 預約`;
    return "可開單";
  }
  return (
    <>
      <main className="pos-shell p-3 md:p-4">
        <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-3">
          <header className="pos-panel rounded-[28px] px-4 py-3 lg:px-5">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.28em] text-amber-700">Cafe POS</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">座位主控台</h1>
                  <p className="text-sm text-slate-500">把主要空間留給座位與預約操作</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 lg:flex lg:shrink-0">
                <button onClick={() => router.push("/reservations")} className="h-11 rounded-2xl bg-fuchsia-100 px-4 text-sm font-semibold text-fuchsia-900 hover:bg-fuchsia-200">今日預約</button>
                <button onClick={() => router.push("/orders")} className="h-11 rounded-2xl bg-sky-100 px-4 text-sm font-semibold text-sky-900 hover:bg-sky-200">歷史訂單</button>
                <button onClick={() => router.push("/dashboard")} className="h-11 rounded-2xl bg-emerald-100 px-4 text-sm font-semibold text-emerald-900 hover:bg-emerald-200">今日後台</button>
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
                    {viewingSession ? `查看中 ${formatSeatLabel(viewingSession.seatCodes)}` : viewingReservation ? `預約中 ${formatSeatLabel(viewingReservation.seatCodes)}` : selectedLabel}
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-rose-100 px-3 py-1.5 font-semibold text-rose-700">紅色 = 使用中</span>
                  <span className="rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-800">黃色 = 目前選取</span>
                  <span className="rounded-full bg-sky-100 px-3 py-1.5 font-semibold text-sky-800">藍色 = 查看中</span>
                  <span className="rounded-full bg-fuchsia-100 px-3 py-1.5 font-semibold text-fuchsia-800">紫色 = 預約保留</span>
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
                    {TABLES.map((table) => (
                      <button key={table} type="button" onClick={() => handleSelectTable(table)} disabled={isLoadingSeats} className={seatClass(table, "table")}>
                        <div>
                          <p className="text-2xl font-bold lg:text-[28px]">{table}桌</p>
                          <p className="mt-1 text-xs font-medium opacity-90">{seatStatusLabel(table)}</p>
                        </div>
                      </button>
                    ))}
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
                    {BAR_SEATS.map((seat) => (
                      <button key={seat} type="button" onClick={() => handleSelectBarSeat(seat)} disabled={isLoadingSeats} className={seatClass(seat, "bar")}>
                        <div>
                          <p className="text-lg font-bold lg:text-xl">{seat}</p>
                          <p className="mt-1 text-[11px] font-medium opacity-90">{seatStatusLabel(seat)}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </section>

            <aside className="grid min-h-0 gap-3 pb-[calc(0.5rem+env(safe-area-inset-bottom))] lg:grid-rows-[minmax(0,1fr)_auto]">
              <section className="pos-panel flex min-h-0 flex-col rounded-[28px] p-3 lg:p-4">
                {viewingSession ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-slate-500">使用中座位</p>
                        <h2 className="mt-1 text-2xl font-bold text-slate-900">現場訂單</h2>
                      </div>
                      <button type="button" onClick={() => setViewingSession(null)} className="h-10 rounded-2xl bg-slate-100 px-3 text-sm font-semibold text-slate-700">關閉</button>
                    </div>
                    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
                      <AsideCard label="主單編號" value={viewingSession.sessionNumber} />
                      <AsideCard label="座位" value={formatSeatLabel(viewingSession.seatCodes)} />
                      <div className="grid grid-cols-2 gap-2">
                        <AsideCard label="來客數" value={`${viewingSession.guestCount} 人`} />
                        <AsideCard label="付款狀態" value={viewingSession.paymentStatus} />
                      </div>
                      <button type="button" onClick={() => router.push(`/session/${viewingSession.sessionId}`)} className="mt-auto h-14 w-full rounded-[22px] bg-sky-500 text-lg font-bold text-white hover:bg-sky-600">進入訂單</button>
                    </div>
                  </>
                ) : viewingReservation ? (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-slate-500">預約座位</p>
                        <h2 className="mt-1 text-2xl font-bold text-slate-900">預約保留</h2>
                      </div>
                      <button type="button" onClick={() => setViewingReservation(null)} className="h-10 rounded-2xl bg-slate-100 px-3 text-sm font-semibold text-slate-700">關閉</button>
                    </div>
                    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-3">
                      <div className="pos-scroll min-h-0 flex-1 space-y-3 pr-1">
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
                          <button type="button" onClick={() => updateReservationStatus(viewingReservation, "cancelled")} className="h-11 rounded-[20px] bg-rose-100 px-3 text-sm font-semibold text-rose-800 hover:bg-rose-200">取消預約</button>
                          <button type="button" onClick={() => updateReservationStatus(viewingReservation, "no_show")} className="h-11 rounded-[20px] bg-slate-200 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-300">標記逾時</button>
                        </div>
                      </div>
                      <button type="button" onClick={handleConvertReservationToSession} disabled={isConvertingReservation} className="h-14 w-full shrink-0 rounded-[22px] bg-emerald-500 text-lg font-bold text-white hover:bg-emerald-600 disabled:opacity-60">{isConvertingReservation ? "轉單中..." : "客到轉開單"}</button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm text-slate-500">右側工作區</p>
                        <h2 className="mt-1 text-xl font-bold text-slate-900">{panelMode === "walkin" ? "新單設定" : "預約保留"}</h2>
                        <p className="mt-1 text-xs text-slate-500">先選座位，再決定是現場開單還是預約保留</p>
                      </div>
                      {(selectedSeats.length > 0 || reservationName || reservationPhone || reservationNotes) && <button type="button" onClick={() => { resetSelectionState(); resetReservationForm(); }} className="h-10 rounded-2xl bg-slate-100 px-3 text-sm font-semibold text-slate-700">清空</button>}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => setPanelMode("walkin")} className={`h-11 rounded-2xl text-sm font-semibold ${panelMode === "walkin" ? "bg-amber-300 text-slate-900" : "bg-slate-100 text-slate-700"}`}>現場開單</button>
                      <button type="button" onClick={() => setPanelMode("reservation")} className={`h-11 rounded-2xl text-sm font-semibold ${panelMode === "reservation" ? "bg-fuchsia-200 text-fuchsia-900" : "bg-slate-100 text-slate-700"}`}>預約</button>
                    </div>
                    <div className="mt-3 rounded-[22px] bg-slate-50 p-3">
                      <p className="text-sm text-slate-500">人數快速設定</p>
                      <div className="mt-3 grid grid-cols-[52px_minmax(0,1fr)_52px] gap-2">
                        <button type="button" onClick={() => setGuestCount((prev) => Math.max(1, prev - 1))} disabled={selectedSeats.length === 0} className="h-11 rounded-2xl bg-slate-200 text-lg font-bold text-slate-800 disabled:opacity-50">-</button>
                        <div className="flex h-11 items-center justify-center rounded-2xl bg-white text-base font-bold text-slate-900 ring-1 ring-slate-200">
                          {guestCount}
                        </div>
                        <button type="button" onClick={() => setGuestCount((prev) => Math.min(guestLimit, prev + 1))} disabled={selectedSeats.length === 0} className="h-11 rounded-2xl bg-slate-200 text-lg font-bold text-slate-800 disabled:opacity-50">+</button>
                      </div>
                      <p className="mt-2 text-xs text-slate-500">{selectedSeats.length === 0 && "請先選擇座位"}{isBarSelection && `吧檯最多 ${selectedSeats.length} 人`}{selectedSeats[0] === "B" && "B 桌可 1-4 人"}{(selectedSeats[0] === "C" || selectedSeats[0] === "D") && "C / D 桌可 1-2 人"}{selectedSeats[0] === "E" && "E 桌為單人座"}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <AsideCard label="目前座位" value={selectedLabel} />
                      <AsideCard label="座位類型" value={seatType} />
                    </div>
                  </>
                )}
              </section>

              {!viewingSession && (
                <>
                  {!viewingReservation && <section className="pos-panel rounded-[28px] p-3">{panelMode === "walkin" ? <button type="button" onClick={handleCreateOrder} disabled={selectedSeats.length === 0 || isCreatingOrder || isLoadingSeats} className="h-14 w-full rounded-[22px] bg-amber-400 text-lg font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-50">{isCreatingOrder ? "建立中..." : "建立新單"}</button> : <button type="button" onClick={openReservationModal} disabled={selectedSeats.length === 0} className="h-14 w-full rounded-[22px] bg-fuchsia-500 text-lg font-bold text-white hover:bg-fuchsia-600 disabled:opacity-50">預約並鎖位</button>}</section>}
                </>
              )}
            </aside>
          </div>
        </div>
      </main>

      {showReservationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
          <div className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-fuchsia-700">預約保留</p>
                <h3 className="mt-1 text-2xl font-bold text-slate-900">輸入預約資料</h3>
                <p className="mt-1 text-xs text-slate-500">{formatSeatLabel(selectedSeats)} / {guestCount} 人</p>
              </div>
              <button type="button" onClick={() => setShowReservationModal(false)} className="h-10 rounded-2xl bg-slate-100 px-3 text-sm font-semibold text-slate-700">關閉</button>
            </div>
            <div className="mt-4 space-y-3">
              <InputField id="reservationName" label="預約姓名" value={reservationName} onChange={setReservationName} placeholder="例如：王小美" />
              <InputField id="reservationPhone" label="預約電話" value={reservationPhone} onChange={setReservationPhone} placeholder="例如：0912345678" />
              <div className="grid grid-cols-2 gap-2">
                <InputField id="reservationDate" label="日期" type="date" value={reservationDate} onChange={setReservationDate} />
                <SelectField id="reservationTime" label="時間" value={reservationTime} onChange={setReservationTime} options={RESERVATION_TIMES} />
              </div>
              <InputField id="reservationNotes" label="備註" value={reservationNotes} onChange={setReservationNotes} placeholder="例如：13:30 到店、靠窗" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setShowReservationModal(false)} className="h-12 rounded-2xl bg-slate-100 text-sm font-semibold text-slate-700">取消</button>
              <button type="button" onClick={handleCreateReservation} disabled={isCreatingReservation} className="h-12 rounded-2xl bg-fuchsia-500 text-sm font-semibold text-white disabled:opacity-50">{isCreatingReservation ? "建立中..." : "確認鎖位"}</button>
            </div>
          </div>
        </div>
      )}
    </>
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

function InputField({ id, label, value, onChange, placeholder, type = "text" }: { id: string; label: string; value: string; onChange: (value: string) => void; placeholder?: string; type?: string; }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-500">{label}</span>
      <input id={id} type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none focus:border-amber-400" />
    </label>
  );
}

function SelectField({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (value: string) => void; options: string[]; }) {
  return (
    <label className="block">
      <span className="text-sm text-slate-500">{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className="mt-2 h-12 w-full rounded-2xl border border-slate-200 bg-white px-4 text-base text-slate-900 outline-none focus:border-amber-400">
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}
