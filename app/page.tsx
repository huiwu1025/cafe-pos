"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type SessionInfo = {
  sessionId: string;
  sessionNumber: string;
  guestCount: number;
  orderStatus: string;
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

  const seatType = useMemo(() => {
    if (selectedSeats.length === 0) return "未選擇";
    return isBarSelection ? "吧檯座位" : "桌位";
  }, [isBarSelection, selectedSeats.length]);

  const selectedLabel = useMemo(() => {
    if (selectedSeats.length === 0) return "尚未選擇";
    if (isBarSelection) return selectedSeats.join("、");
    return `${selectedSeats[0]}桌`;
  }, [isBarSelection, selectedSeats]);

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
      const revenue = rows
        .filter((row) => row.payment_status === "paid")
        .reduce((sum, row) => sum + Number(row.total_amount ?? 0), 0);
      const guests = rows.reduce((sum, row) => sum + Number(row.guest_count ?? 0), 0);
      const unpaidCount = rows.filter(
        (row) => row.order_status === "open" && row.payment_status === "unpaid"
      ).length;

      setSummary({
        revenue,
        guests,
        orderCount: rows.length,
        unpaidCount,
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
        const isOccupied =
          session?.order_status === "open" && session?.payment_status === "unpaid";

        if (!isOccupied || !seat?.seat_code || !session?.id) continue;

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
            orderStatus: session.order_status,
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
      console.error("載入座位佔用狀態失敗：", error);
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

    if (aIsBar && bIsBar) {
      return Number(a.replace("A", "")) - Number(b.replace("A", ""));
    }

    return a.localeCompare(b);
  }

  function formatSeatLabel(seatCodes: string[]) {
    const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
    if (isAllBar) return seatCodes.join("、");
    return seatCodes.map((seat) => `${seat}桌`).join("、");
  }

  function getOccupiedSessionBySeat(seatCode: string) {
    return occupiedSeats[seatCode] ?? null;
  }

  function isSeatOccupied(seatCode: string) {
    return Boolean(occupiedSeats[seatCode]);
  }

  function resetOpenPanelState() {
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

    if (table === "B") setGuestCount(2);
    if (table === "C" || table === "D") setGuestCount(2);
    if (table === "E") setGuestCount(1);
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
      const onlyBarSeats = prev.filter((item) => item.startsWith("A"));
      const nextSeats = onlyBarSeats.includes(seat)
        ? onlyBarSeats.filter((item) => item !== seat)
        : [...onlyBarSeats, seat];

      nextSeats.sort(sortSeatCodes);
      setGuestCount(nextSeats.length === 0 ? 1 : nextSeats.length);

      return nextSeats;
    });
  }

  function generateSessionNumber() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    const h = String(now.getHours()).padStart(2, "0");
    const min = String(now.getMinutes()).padStart(2, "0");
    const s = String(now.getSeconds()).padStart(2, "0");

    return `S${y}${m}${d}-${h}${min}${s}`;
  }

  async function handleCreateOrder() {
    if (selectedSeats.length === 0) {
      alert("請先選擇座位");
      return;
    }

    const hasOccupiedSeat = selectedSeats.some((seat) => isSeatOccupied(seat));
    if (hasOccupiedSeat) {
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
      if (!seatRows || seatRows.length === 0) {
        throw new Error("找不到對應的座位資料");
      }

      const sessionSeatPayload = seatRows.map((seat) => ({
        session_id: sessionData.id,
        seat_id: seat.id,
      }));

      const { error: sessionSeatsError } = await supabase
        .from("session_seats")
        .insert(sessionSeatPayload);

      if (sessionSeatsError) throw sessionSeatsError;

      resetOpenPanelState();
      await loadOccupiedSeats();
      await loadTodaySummary();
      router.push(`/session/${sessionData.id}`);
    } catch (error) {
      console.error("建立新單失敗：", error);
      alert("建立新單失敗，請查看 console 錯誤訊息");
    } finally {
      setIsCreating(false);
    }
  }

  function getSeatClass(seat: string, size: "table" | "bar") {
    const isSelected = selectedSeats.includes(seat);
    const occupied = isSeatOccupied(seat);
    const isViewing = viewingSession?.seatCodes.includes(seat);
    const height = size === "table" ? "min-h-[132px]" : "min-h-[112px]";

    const base =
      `${height} rounded-[28px] border px-3 py-4 text-center shadow-sm transition ` +
      "active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70";

    if (isViewing) return `${base} border-blue-200 bg-blue-500 text-white ring-4 ring-blue-100`;
    if (occupied) return `${base} border-rose-200 bg-rose-500 text-white ring-4 ring-rose-100`;
    if (isSelected) {
      return `${base} border-amber-200 bg-amber-300 text-slate-900 ring-4 ring-amber-100`;
    }
    return `${base} border-slate-200 bg-white text-slate-900 hover:border-amber-200 hover:bg-amber-50`;
  }

  const selectionGuestLimit = isBarSelection
    ? selectedSeats.length || 1
    : selectedSeats[0] === "B"
    ? 4
    : selectedSeats[0] === "E"
    ? 1
    : 2;

  return (
    <main className="pos-shell p-3 md:p-4">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-3 lg:gap-4">
        <header className="pos-panel rounded-[30px] px-4 py-4 lg:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-amber-700">
                Cafe POS
              </p>
              <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
                <h1 className="text-3xl font-bold text-slate-900 lg:text-4xl">座位主控台</h1>
                <p className="pb-1 text-base text-slate-500">
                  平板優先的一屏式開單與現場操作
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:flex">
              <button
                onClick={() => router.push("/orders")}
                className="min-h-[58px] rounded-2xl bg-sky-100 px-5 text-base font-semibold text-sky-900 transition hover:bg-sky-200"
              >
                歷史訂單
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="min-h-[58px] rounded-2xl bg-emerald-100 px-5 text-base font-semibold text-emerald-900 transition hover:bg-emerald-200"
              >
                今日後台
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          {[
            { label: "今日營業額", value: `$${summary.revenue}`, tone: "text-emerald-700" },
            { label: "今日來客數", value: `${summary.guests} 人`, tone: "text-sky-700" },
            { label: "今日訂單數", value: `${summary.orderCount} 張`, tone: "text-violet-700" },
            { label: "未結帳單數", value: `${summary.unpaidCount} 張`, tone: "text-rose-700" },
          ].map((item) => (
            <div key={item.label} className="pos-panel rounded-[28px] px-4 py-4 lg:px-5">
              <p className="text-sm text-slate-500">{item.label}</p>
              <p className={`mt-3 text-3xl font-bold lg:text-4xl ${item.tone}`}>{item.value}</p>
            </div>
          ))}
        </section>

        <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1.45fr)_23rem] lg:gap-4">
          <div className="pos-panel min-h-0 rounded-[32px] p-4 lg:p-5">
            <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500">目前狀態</p>
                <h2 className="mt-2 text-3xl font-bold text-slate-900 lg:text-4xl">
                  {viewingSession ? `查看中：${formatSeatLabel(viewingSession.seatCodes)}` : selectedLabel}
                </h2>
              </div>

              <div className="flex flex-wrap gap-2 text-sm">
                <span className="rounded-full bg-rose-100 px-4 py-2 font-semibold text-rose-700">
                  紅色 = 使用中
                </span>
                <span className="rounded-full bg-amber-100 px-4 py-2 font-semibold text-amber-800">
                  黃色 = 目前選取
                </span>
                <span className="rounded-full bg-sky-100 px-4 py-2 font-semibold text-sky-800">
                  藍色 = 查看中
                </span>
              </div>
            </div>

            <div className="grid h-[calc(100%-5.5rem)] min-h-0 gap-4 lg:grid-rows-[auto_minmax(0,1fr)]">
              <section className="rounded-[28px] bg-slate-50/85 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-slate-900">桌位區</h3>
                    <p className="text-sm text-slate-500">單選開單</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-500">
                    4 桌
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  {TABLES.map((table) => (
                    <button
                      key={table}
                      type="button"
                      onClick={() => handleSelectTable(table)}
                      disabled={isLoadingOccupied}
                      className={getSeatClass(table, "table")}
                    >
                      <div className="space-y-2">
                        <p className="text-3xl font-bold">{table}桌</p>
                        <p className="text-sm font-medium opacity-85">
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

              <section className="min-h-0 rounded-[28px] bg-slate-50/85 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <h3 className="text-2xl font-bold text-slate-900">吧檯座位</h3>
                    <p className="text-sm text-slate-500">可複選開單</p>
                  </div>
                  <span className="rounded-full bg-white px-3 py-1 text-sm font-medium text-slate-500">
                    7 位
                  </span>
                </div>

                <div className="grid min-h-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
                  {BAR_SEATS.map((seat) => (
                    <button
                      key={seat}
                      type="button"
                      onClick={() => handleSelectBarSeat(seat)}
                      disabled={isLoadingOccupied}
                      className={getSeatClass(seat, "bar")}
                    >
                      <div className="space-y-1">
                        <p className="text-2xl font-bold">{seat}</p>
                        <p className="text-sm font-medium opacity-85">
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
          </div>

          <aside className="flex min-h-0 flex-col gap-3 lg:gap-4">
            <section className="pos-panel flex min-h-0 flex-1 flex-col rounded-[32px] p-4 lg:p-5">
              {viewingSession ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-500">使用中主單</p>
                      <h2 className="mt-2 text-3xl font-bold text-slate-900">查看既有訂單</h2>
                    </div>
                    <button
                      type="button"
                      onClick={() => setViewingSession(null)}
                      className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                    >
                      關閉
                    </button>
                  </div>

                  <div className="pos-scroll mt-5 space-y-4 pr-1">
                    <InfoCard label="主單編號" value={viewingSession.sessionNumber} />
                    <InfoCard label="座位" value={formatSeatLabel(viewingSession.seatCodes)} />
                    <div className="grid grid-cols-2 gap-3">
                      <InfoCard label="來客數" value={`${viewingSession.guestCount} 人`} />
                      <InfoCard label="付款狀態" value={viewingSession.paymentStatus} />
                    </div>
                    <button
                      onClick={() => router.push(`/session/${viewingSession.sessionId}`)}
                      className="min-h-[64px] w-full rounded-[24px] bg-sky-500 px-4 text-xl font-bold text-white transition hover:bg-sky-600"
                    >
                      進入訂單
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-500">開單區</p>
                      <h2 className="mt-2 text-3xl font-bold text-slate-900">新單設定</h2>
                      <p className="mt-2 text-sm text-slate-500">
                        選擇座位後在這裡確認人數與建立訂單
                      </p>
                    </div>

                    {selectedSeats.length > 0 && (
                      <button
                        type="button"
                        onClick={resetOpenPanelState}
                        className="rounded-2xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-200"
                      >
                        清除
                      </button>
                    )}
                  </div>

                  <div className="pos-scroll mt-5 space-y-4 pr-1">
                    <InfoCard label="目前座位" value={selectedLabel} />
                    <InfoCard label="座位類型" value={seatType} />
                    <div className="rounded-[28px] border border-slate-200 bg-white p-4">
                      <label htmlFor="guestCount" className="text-sm font-medium text-slate-500">
                        來客數
                      </label>
                      <input
                        id="guestCount"
                        type="number"
                        min={1}
                        max={selectionGuestLimit}
                        value={guestCount}
                        onChange={(e) => setGuestCount(Number(e.target.value))}
                        disabled={selectedSeats.length === 0}
                        className="mt-3 h-16 w-full rounded-2xl border border-slate-200 px-4 text-2xl font-bold text-slate-900 outline-none focus:border-amber-400 disabled:bg-slate-100"
                      />
                      <p className="mt-3 text-sm text-slate-500">
                        {isBarSelection && `吧檯位已選 ${selectedSeats.length} 個座位`}
                        {selectedSeats[0] === "B" && "B桌建議 2 到 4 人"}
                        {(selectedSeats[0] === "C" || selectedSeats[0] === "D") &&
                          "C / D 桌建議 2 人"}
                        {selectedSeats[0] === "E" && "E桌建議 1 人"}
                        {selectedSeats.length === 0 && "請先點選左側座位"}
                      </p>
                    </div>

                    <div className="rounded-[28px] bg-amber-50 p-4 text-sm leading-6 text-amber-900">
                      POS 操作建議：
                      <br />
                      桌位使用單選，吧檯可複選。點到紅色座位會直接切換成查看既有訂單。
                    </div>
                  </div>
                </>
              )}
            </section>

            {!viewingSession && (
              <section className="pos-panel rounded-[32px] p-4">
                <button
                  type="button"
                  onClick={handleCreateOrder}
                  disabled={selectedSeats.length === 0 || isCreating || isLoadingOccupied}
                  className="min-h-[72px] w-full rounded-[24px] bg-amber-400 px-4 text-2xl font-bold text-slate-900 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isCreating ? "建立中..." : "建立新單"}
                </button>
              </section>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[28px] bg-slate-50 px-4 py-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
