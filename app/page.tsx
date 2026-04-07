"use client";

import { useEffect, useMemo, useState } from "react";
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

export default function Home() {
  const router = useRouter();

  const tables = ["E", "D", "C", "B"];
  const barSeats = ["A7", "A6", "A5", "A4", "A3", "A2", "A1"];

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
    if (selectedSeats.length === 0) return null;
    if (isBarSelection) return "吧檯座位";
    return "桌位";
  }, [selectedSeats, isBarSelection]);

  const selectedLabel =
    selectedSeats.length === 0
      ? "尚未選擇"
      : isBarSelection
      ? selectedSeats.join("、")
      : `${selectedSeats[0]}桌`;

  useEffect(() => {
    loadOccupiedSeats();
    loadTodaySummary();
  }, []);

  async function loadTodaySummary() {
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
  }

  async function loadOccupiedSeats() {
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
        sessionInfo.seatCodes.sort((a, b) => {
          const aIsBar = a.startsWith("A");
          const bIsBar = b.startsWith("A");

          if (aIsBar && bIsBar) {
            return Number(a.replace("A", "")) - Number(b.replace("A", ""));
          }

          return a.localeCompare(b);
        });

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

    if (table === "B") {
      setGuestCount(2);
    } else if (table === "C" || table === "D") {
      setGuestCount(2);
    } else if (table === "E") {
      setGuestCount(1);
    }
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

      let nextSeats: string[];

      if (onlyBarSeats.includes(seat)) {
        nextSeats = onlyBarSeats.filter((item) => item !== seat);
      } else {
        nextSeats = [...onlyBarSeats, seat];
      }

      nextSeats.sort((a, b) => {
        const aNum = Number(a.replace("A", ""));
        const bNum = Number(b.replace("A", ""));
        return aNum - bNum;
      });

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

      alert(`建立成功！\n主單編號：${sessionNumber}`);

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

  function getTableClass(table: string) {
    const isSelected = selectedSeats.includes(table);
    const occupied = isSeatOccupied(table);
    const isViewing = viewingSession?.seatCodes.includes(table);

    const base =
      "relative flex h-[150px] items-center justify-center rounded-[28px] border text-[22px] font-bold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70";

    if (isViewing) return `${base} border-blue-300 bg-blue-500 text-white ring-4 ring-blue-200`;
    if (occupied) return `${base} border-red-300 bg-red-500 text-white ring-4 ring-red-200`;
    if (isSelected)
      return `${base} border-amber-300 bg-amber-300 text-gray-900 ring-4 ring-amber-200`;
    return `${base} border-gray-200 bg-white text-gray-900`;
  }

  function getBarSeatClass(seat: string) {
    const isSelected = selectedSeats.includes(seat);
    const occupied = isSeatOccupied(seat);
    const isViewing = viewingSession?.seatCodes.includes(seat);

    const base =
      "relative flex h-[132px] items-center justify-center rounded-[28px] border text-[20px] font-bold shadow-sm transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-70";

    if (isViewing) return `${base} border-blue-300 bg-blue-500 text-white ring-4 ring-blue-200`;
    if (occupied) return `${base} border-red-300 bg-red-500 text-white ring-4 ring-red-200`;
    if (isSelected)
      return `${base} border-amber-300 bg-amber-300 text-gray-900 ring-4 ring-amber-200`;
    return `${base} border-gray-200 bg-white text-gray-900`;
  }

  function formatSeatLabel(seatCodes: string[]) {
    const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
    if (isAllBar) return seatCodes.join("、");
    return seatCodes.map((seat) => `${seat}桌`).join("、");
  }

  return (
    <main className="min-h-screen bg-[#f6f6f3] p-3">
      <div className="mx-auto flex max-w-[1800px] flex-col gap-4 xl:h-[calc(100vh-24px)]">
        <header className="rounded-[32px] bg-white px-5 py-5 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl font-bold text-gray-900">店內座位圖</h1>
              <p className="mt-2 text-lg text-gray-500">管理現場座位、歷史訂單與今日後台</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => router.push("/orders")}
                className="min-h-[58px] rounded-2xl bg-blue-100 px-6 text-xl font-semibold text-blue-800 hover:bg-blue-200"
              >
                歷史訂單
              </button>
              <button
                onClick={() => router.push("/dashboard")}
                className="min-h-[58px] rounded-2xl bg-emerald-100 px-6 text-xl font-semibold text-emerald-800 hover:bg-emerald-200"
              >
                今日後台
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-4 gap-3">
          <div className="rounded-[28px] bg-white p-4 shadow-sm">
            <p className="text-base text-gray-500">今日營業額</p>
            <p className="mt-2 text-4xl font-bold text-gray-900">${summary.revenue}</p>
          </div>
          <div className="rounded-[28px] bg-white p-4 shadow-sm">
            <p className="text-base text-gray-500">今日來客數</p>
            <p className="mt-2 text-4xl font-bold text-gray-900">{summary.guests} 人</p>
          </div>
          <div className="rounded-[28px] bg-white p-4 shadow-sm">
            <p className="text-base text-gray-500">今日訂單數</p>
            <p className="mt-2 text-4xl font-bold text-gray-900">{summary.orderCount} 張</p>
          </div>
          <div className="rounded-[28px] bg-white p-4 shadow-sm">
            <p className="text-base text-gray-500">未結帳單數</p>
            <p className="mt-2 text-4xl font-bold text-gray-900">{summary.unpaidCount} 張</p>
          </div>
        </section>

        <div className="grid flex-1 gap-4 xl:min-h-0 xl:grid-cols-[1.45fr_0.78fr]">
          <section className="rounded-[32px] bg-white p-5 shadow-sm xl:min-h-0 xl:overflow-hidden">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <p className="text-base text-gray-500">目前狀態</p>
                <p className="mt-1 text-4xl font-bold text-gray-900">
                  {viewingSession
                    ? `查看中：${formatSeatLabel(viewingSession.seatCodes)}`
                    : selectedLabel}
                </p>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
                <span className="rounded-full bg-red-100 px-4 py-2 font-semibold text-red-700">
                  紅色 = 使用中
                </span>
                <span className="rounded-full bg-amber-100 px-4 py-2 font-semibold text-amber-700">
                  黃色 = 目前選取
                </span>
                <span className="rounded-full bg-blue-100 px-4 py-2 font-semibold text-blue-700">
                  藍色 = 查看中
                </span>
              </div>
            </div>

            <div className="grid h-[calc(100%-88px)] grid-rows-[auto_auto] gap-6">
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[34px] font-bold text-gray-900">桌位</h2>
                  <p className="text-lg text-gray-500">單選</p>
                </div>

                <div className="grid grid-cols-4 gap-3">
                  {tables.map((table) => (
                    <button
                      key={table}
                      type="button"
                      onClick={() => handleSelectTable(table)}
                      disabled={isLoadingOccupied}
                      className={getTableClass(table)}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <span>{table}桌</span>
                        {viewingSession?.seatCodes.includes(table) ? (
                          <span className="text-base font-medium opacity-95">查看中</span>
                        ) : isSeatOccupied(table) ? (
                          <span className="text-base font-medium opacity-95">使用中</span>
                        ) : (
                          <span className="text-base font-medium opacity-70">可開單</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="min-h-0">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[34px] font-bold text-gray-900">吧檯座位</h2>
                  <p className="text-lg text-gray-500">可複選</p>
                </div>

                <div className="grid grid-cols-7 gap-3">
                  {barSeats.map((seat) => (
                    <button
                      key={seat}
                      type="button"
                      onClick={() => handleSelectBarSeat(seat)}
                      disabled={isLoadingOccupied}
                      className={getBarSeatClass(seat)}
                    >
                      <div className="flex flex-col items-center gap-1">
                        <span>{seat}</span>
                        {viewingSession?.seatCodes.includes(seat) ? (
                          <span className="text-sm font-medium opacity-95">查看中</span>
                        ) : isSeatOccupied(seat) ? (
                          <span className="text-sm font-medium opacity-95">使用中</span>
                        ) : (
                          <span className="text-sm font-medium opacity-70">可開單</span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <aside className="flex min-h-0 flex-col gap-4">
            <section className="flex-1 rounded-[32px] bg-white p-5 shadow-sm">
              {viewingSession ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[34px] font-bold text-gray-900">既有主單資訊</h2>
                      <p className="mt-1 text-base text-gray-500">點使用中的座位可快速查看</p>
                    </div>

                    <button
                      type="button"
                      onClick={() => setViewingSession(null)}
                      className="min-h-[48px] rounded-2xl bg-gray-100 px-4 text-base font-medium text-gray-700 hover:bg-gray-200"
                    >
                      關閉
                    </button>
                  </div>

                  <div className="mt-6 space-y-5">
                    <div className="rounded-2xl bg-gray-50 p-4">
                      <p className="text-sm text-gray-500">主單編號</p>
                      <p className="mt-2 text-2xl font-bold text-gray-900">
                        {viewingSession.sessionNumber}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                      <p className="text-sm text-gray-500">座位</p>
                      <p className="mt-2 text-2xl font-bold text-gray-900">
                        {formatSeatLabel(viewingSession.seatCodes)}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-gray-50 p-4">
                        <p className="text-sm text-gray-500">來客數</p>
                        <p className="mt-2 text-2xl font-bold text-gray-900">
                          {viewingSession.guestCount} 人
                        </p>
                      </div>
                      <div className="rounded-2xl bg-gray-50 p-4">
                        <p className="text-sm text-gray-500">付款狀態</p>
                        <p className="mt-2 text-2xl font-bold text-gray-900">
                          {viewingSession.paymentStatus}
                        </p>
                      </div>
                    </div>

                    <button
                      onClick={() => router.push(`/session/${viewingSession.sessionId}`)}
                      className="min-h-[64px] w-full rounded-2xl bg-blue-500 px-4 text-2xl font-bold text-white hover:bg-blue-600"
                    >
                      進入訂單
                    </button>
                  </div>
                </>
              ) : selectedSeats.length === 0 ? (
                <>
                  <h2 className="text-[34px] font-bold text-gray-900">開單面板</h2>
                  <div className="mt-6 rounded-2xl bg-gray-100 p-5 text-xl text-gray-600">
                    請先點選一個空位或空桌
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h2 className="text-[34px] font-bold text-gray-900">開單面板</h2>
                      <p className="mt-1 text-base text-gray-500">確認座位與來客數後開單</p>
                    </div>

                    <button
                      type="button"
                      onClick={resetOpenPanelState}
                      className="min-h-[48px] rounded-2xl bg-gray-100 px-4 text-base font-medium text-gray-700 hover:bg-gray-200"
                    >
                      清除
                    </button>
                  </div>

                  <div className="mt-6 space-y-5">
                    <div className="rounded-2xl bg-gray-50 p-4">
                      <p className="text-sm text-gray-500">目前座位</p>
                      <p className="mt-2 text-3xl font-bold text-gray-900">{selectedLabel}</p>
                    </div>

                    <div className="rounded-2xl bg-gray-50 p-4">
                      <p className="text-sm text-gray-500">座位類型</p>
                      <p className="mt-2 text-2xl font-bold text-gray-900">{seatType}</p>
                    </div>

                    <div className="rounded-2xl border border-gray-200 p-4">
                      <label
                        htmlFor="guestCount"
                        className="block text-base font-medium text-gray-700"
                      >
                        來客數
                      </label>
                      <input
                        id="guestCount"
                        type="number"
                        min={1}
                        max={
                          isBarSelection
                            ? selectedSeats.length || 1
                            : selectedSeats[0] === "B"
                            ? 4
                            : selectedSeats[0] === "E"
                            ? 1
                            : 2
                        }
                        value={guestCount}
                        onChange={(e) => setGuestCount(Number(e.target.value))}
                        className="mt-2 h-16 w-full rounded-2xl border border-gray-300 px-4 text-2xl outline-none focus:border-amber-500"
                      />
                      <p className="mt-3 text-sm text-gray-500">
                        {isBarSelection && `吧檯位已選 ${selectedSeats.length} 個座位`}
                        {selectedSeats[0] === "B" && "B桌建議 2～4 人"}
                        {(selectedSeats[0] === "C" || selectedSeats[0] === "D") &&
                          "此桌建議 2 人"}
                        {selectedSeats[0] === "E" && "此桌建議 1 人"}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </section>

            {!viewingSession && selectedSeats.length > 0 && (
              <section className="rounded-[32px] bg-white p-4 shadow-sm">
                <button
                  type="button"
                  onClick={handleCreateOrder}
                  disabled={isCreating || isLoadingOccupied}
                  className="min-h-[72px] w-full rounded-2xl bg-amber-400 px-4 text-3xl font-bold text-gray-900 shadow transition hover:bg-amber-300 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
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