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

type OccupiedSeatMap = Record<string, SessionInfo>;

type DashboardSummary = {
  revenue: number;
  guests: number;
  orderCount: number;
  unpaidCount: number;
};

const TABLES = ["E", "D", "C", "B"];
const BAR_SEATS = ["A7", "A6", "A5", "A4", "A3", "A2", "A1"];

export default function Home() {
  const router = useRouter();
  const [selectedSeats, setSelectedSeats] = useState<string[]>([]);
  const [guestCount, setGuestCount] = useState(1);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoadingOccupied, setIsLoadingOccupied] = useState(true);
  const [occupiedSeats, setOccupiedSeats] = useState<OccupiedSeatMap>({});
  const [viewingSession, setViewingSession] = useState<SessionInfo | null>(null);
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
      console.error("載入今日摘要失敗：", error);
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
            guestCount: session.guest_count,
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
      console.error("載入座位狀態失敗：", error);
      alert("載入座位狀態失敗，請查看 console");
    } finally {
      setIsLoadingOccupied(false);
    }
  }, []);

  useEffect(() => {
    loadOccupiedSeats();
    loadTodaySummary();
  }, [loadOccupiedSeats, loadTodaySummary]);

  function sortSeatCodes(a: string, b: string) {
    const aIsBar = a.startsWith("A");
    const bIsBar = b.startsWith("A");
    if (aIsBar && bIsBar) return Number(a.replace("A", "")) - Number(b.replace("A", ""));
    return a.localeCompare(b);
  }

  function isSeatOccupied(seatCode: string) {
    return Boolean(occupiedSeats[seatCode]);
  }

  function getOccupiedSessionBySeat(seatCode: string) {
    return occupiedSeats[seatCode] ?? null;
  }

  function formatSeatLabel(seatCodes: string[]) {
    const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
    if (isAllBar) return seatCodes.join("、");
    return seatCodes.map((seat) => `${seat}桌`).join("、");
  }

  function resetPanelState() {
    setSelectedSeats([]);
    setGuestCount(1);
    setViewingSession(null);
  }

  function handleSelectTable(table: string) {
    const occupiedSession = getOccupiedSessionBySeat(table);

    if (occupiedSession) {
      setViewingSession(occupiedSession);
      setSelectedSeats([]);
      return;
    }

    setViewingSession(null);
    setSelectedSeats([table]);
    setGuestCount(table === "E" ? 1 : 2);
  }

  function handleSelectBarSeat(seat: string) {
    const occupiedSession = getOccupiedSessionBySeat(seat);

    if (occupiedSession) {
      setViewingSession(occupiedSession);
      setSelectedSeats([]);
      return;
    }

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

  async function handleCreateOrder() {
    if (selectedSeats.length === 0) {
      alert("請先選擇座位");
      return;
    }

    if (selectedSeats.some((seat) => isSeatOccupied(seat))) {
      alert("所選座位中有使用中的位置，請重新選擇");
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

      const { data: seatRows, error: seatsError } = await supabase
        .from("seats")
        .select("id, seat_code")
        .in("seat_code", selectedSeats);

      if (seatsError) throw seatsError;
      if (!seatRows || seatRows.length === 0) throw new Error("找不到對應座位");

      const { error: sessionSeatsError } = await supabase
        .from("session_seats")
        .insert(
          seatRows.map((seat) => ({
            session_id: sessionData.id,
            seat_id: seat.id,
          }))
        );

      if (sessionSeatsError) throw sessionSeatsError;

      resetPanelState();
      await loadOccupiedSeats();
      await loadTodaySummary();
      router.push(`/session/${sessionData.id}`);
    } catch (error) {
      console.error("建立新單失敗：", error);
      alert("建立新單失敗，請查看 console");
    } finally {
      setIsCreating(false);
    }
  }

  function seatClass(seat: string, variant: "table" | "bar") {
    const selected = selectedSeats.includes(seat);
    const viewing = viewingSession?.seatCodes.includes(seat);
    const occupied = isSeatOccupied(seat);
    const height = variant === "table" ? "h-[92px] lg:h-[104px]" : "h-[82px] lg:h-[92px]";
    const base =
      `${height} rounded-[22px] border px-3 py-2 text-center shadow-sm transition ` +
      "active:scale-[0.99] disabled:opacity-70";

    if (viewing) return `${base} border-sky-200 bg-sky-500 text-white`;
    if (occupied) return `${base} border-rose-200 bg-rose-500 text-white`;
    if (selected) return `${base} border-amber-200 bg-amber-300 text-slate-900`;
    return `${base} border-slate-200 bg-white text-slate-900 hover:bg-amber-50`;
  }

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
                <p className="text-sm text-slate-500">把主要空間留給座位區與開單</p>
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

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.5fr)_320px]">
          <section className="pos-panel min-h-0 rounded-[28px] p-3 lg:p-4">
            <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-sm text-slate-500">目前狀態</p>
                <h2 className="mt-1 text-2xl font-bold text-slate-900 lg:text-3xl">
                  {viewingSession ? `查看中：${formatSeatLabel(viewingSession.seatCodes)}` : selectedLabel}
                </h2>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-rose-100 px-3 py-1.5 font-semibold text-rose-700">
                  紅色 = 使用中
                </span>
                <span className="rounded-full bg-amber-100 px-3 py-1.5 font-semibold text-amber-800">
                  黃色 = 已選取
                </span>
                <span className="rounded-full bg-sky-100 px-3 py-1.5 font-semibold text-sky-800">
                  藍色 = 查看中
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
                  {TABLES.map((table) => (
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
                            : isSeatOccupied(table)
                            ? "使用中"
                            : "可開單"}
                        </p>
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
                            : isSeatOccupied(seat)
                            ? "使用中"
                            : "可開單"}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-3">
            <section className="pos-panel flex min-h-0 flex-1 flex-col rounded-[28px] p-3 lg:p-4">
              {viewingSession ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-500">既有主單</p>
                      <h2 className="mt-1 text-2xl font-bold text-slate-900">查看訂單</h2>
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
                      進入訂單
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm text-slate-500">開單區</p>
                      <h2 className="mt-1 text-2xl font-bold text-slate-900">新單設定</h2>
                      <p className="mt-1 text-xs text-slate-500">
                        先選座位，再調整來客數後開單
                      </p>
                    </div>
                    {selectedSeats.length > 0 && (
                      <button
                        type="button"
                        onClick={resetPanelState}
                        className="h-10 rounded-2xl bg-slate-100 px-3 text-sm font-semibold text-slate-700"
                      >
                        清除
                      </button>
                    )}
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
                        onChange={(e) => setGuestCount(Number(e.target.value))}
                        disabled={selectedSeats.length === 0}
                        className="mt-2 h-14 w-full rounded-2xl border border-slate-200 bg-white px-4 text-xl font-bold text-slate-900 outline-none focus:border-amber-400 disabled:bg-slate-100"
                      />
                      <p className="mt-2 text-xs text-slate-500">
                        {selectedSeats.length === 0 && "請先從左側座位區選位"}
                        {isBarSelection && `吧檯最多 ${selectedSeats.length} 人`}
                        {selectedSeats[0] === "B" && "B桌建議 2 到 4 人"}
                        {(selectedSeats[0] === "C" || selectedSeats[0] === "D") &&
                          "C / D 桌建議 2 人"}
                        {selectedSeats[0] === "E" && "E桌建議 1 人"}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </section>

            {!viewingSession && (
              <section className="pos-panel rounded-[28px] p-3">
                <button
                  type="button"
                  onClick={handleCreateOrder}
                  disabled={selectedSeats.length === 0 || isCreating || isLoadingOccupied}
                  className="h-14 w-full rounded-[22px] bg-amber-400 text-lg font-bold text-slate-900 hover:bg-amber-300 disabled:opacity-50"
                >
                  {isCreating ? "建立中..." : "建立新單"}
                </button>
              </section>
            )}
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
