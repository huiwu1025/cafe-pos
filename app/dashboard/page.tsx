"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type SessionRow = {
  id: string;
  session_number: string;
  guest_count: number;
  order_status: string;
  payment_status: string;
  payment_method?: string | null;
  total_amount: number;
  customer_type?: string | null;
  created_at?: string | null;
};

type OrderItemRow = {
  id: string;
  session_id: string;
  product_name: string;
  quantity: number;
  line_total: number;
  status: string;
  is_complimentary?: boolean | null;
};

type SessionSeatRow = {
  session_id: string;
  seats: { seat_code: string } | { seat_code: string }[] | null;
};

type ActiveSessionCard = {
  id: string;
  session_number: string;
  guest_count: number;
  total_amount: number;
  customer_type?: string | null;
  seat_codes: string[];
};

type TimeBlock = {
  label: string;
  startHour: number;
  endHour: number;
  orderCount: number;
  guestCount: number;
  revenue: number;
};

type CashCountRow = {
  id: string;
  business_date: string;
  opening_cash: number | null;
  opening_breakdown?: Record<string, number> | null;
  opening_notes: string | null;
  opening_counted_at: string | null;
  closing_cash: number | null;
  closing_breakdown?: Record<string, number> | null;
  closing_notes: string | null;
  closing_counted_at: string | null;
};

type CashBreakdown = Record<string, number>;

const CASH_DENOMINATIONS = [1000, 500, 100, 50, 10, 5, 1];

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
  return a.localeCompare(b, "zh-Hant");
}

function formatSeatLabel(seatCodes: string[]) {
  if (seatCodes.length === 0) return "未指定座位";
  const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
  if (isAllBar) return seatCodes.join("、");
  return seatCodes.map((seat) => `${seat}桌`).join("、");
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "尚未清點";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, "0")}/${String(
    date.getDate()
  ).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes()
  ).padStart(2, "0")}`;
}

function createEmptyBreakdown(): CashBreakdown {
  return Object.fromEntries(CASH_DENOMINATIONS.map((denomination) => [String(denomination), 0]));
}

function normalizeBreakdown(input: Record<string, unknown> | null | undefined): CashBreakdown {
  const next = createEmptyBreakdown();

  for (const denomination of CASH_DENOMINATIONS) {
    const key = String(denomination);
    const rawValue = input?.[key];
    const numericValue =
      typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string"
          ? Number(rawValue)
          : 0;
    next[key] = Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : 0;
  }

  return next;
}

function calculateBreakdownTotal(breakdown: CashBreakdown) {
  return CASH_DENOMINATIONS.reduce((sum, denomination) => {
    return sum + denomination * Number(breakdown[String(denomination)] ?? 0);
  }, 0);
}

export default function DashboardPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"overview" | "cash">("overview");
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionCard[]>([]);
  const [cashCount, setCashCount] = useState<CashCountRow | null>(null);
  const [openingBreakdown, setOpeningBreakdown] = useState<CashBreakdown>(createEmptyBreakdown);
  const [openingNotesInput, setOpeningNotesInput] = useState("");
  const [closingBreakdown, setClosingBreakdown] = useState<CashBreakdown>(createEmptyBreakdown);
  const [closingNotesInput, setClosingNotesInput] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingOpening, setIsSavingOpening] = useState(false);
  const [isSavingClosing, setIsSavingClosing] = useState(false);

  const loadDashboard = useCallback(async () => {
    try {
      setIsLoading(true);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);
      const businessDate = todayIsoDate();

      const { data: sessionsData, error: sessionsError } = await supabase
        .from("dining_sessions")
        .select("*")
        .gte("created_at", todayStart.toISOString())
        .lt("created_at", tomorrowStart.toISOString())
        .order("created_at", { ascending: false });

      if (sessionsError) throw sessionsError;

      const sessionIds = (sessionsData ?? []).map((item) => item.id);
      let itemsData: OrderItemRow[] = [];

      if (sessionIds.length > 0) {
        const { data, error } = await supabase.from("order_items").select("*").in("session_id", sessionIds);
        if (error) throw error;
        itemsData = data ?? [];
      }

      const { data: activeData, error: activeError } = await supabase
        .from("dining_sessions")
        .select("*")
        .eq("order_status", "open")
        .eq("payment_status", "unpaid")
        .order("created_at", { ascending: false });

      if (activeError) throw activeError;

      const seatMap = new Map<string, string[]>();

      if ((activeData ?? []).length > 0) {
        const { data: seatData, error: seatError } = await supabase
          .from("session_seats")
          .select(
            `
              session_id,
              seats:seat_id (
                seat_code
              )
            `
          )
          .in(
            "session_id",
            (activeData ?? []).map((item) => item.id)
          );

        if (seatError) throw seatError;

        for (const row of (seatData ?? []) as SessionSeatRow[]) {
          const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
          if (!seat?.seat_code) continue;
          const current = seatMap.get(row.session_id) ?? [];
          current.push(seat.seat_code);
          seatMap.set(row.session_id, current);
        }
      }

      const { data: cashData, error: cashError } = await supabase
        .from("daily_cash_counts")
        .select("*")
        .eq("business_date", businessDate)
        .maybeSingle();

      if (cashError) {
        const maybeMessage = (cashError as { message?: string }).message ?? "";
        if (!maybeMessage.includes("daily_cash_counts")) {
          throw cashError;
        }
      }

      setSessions(sessionsData ?? []);
      setOrderItems(itemsData);
      setActiveSessions(
        (activeData ?? []).map((session) => ({
          id: session.id,
          session_number: session.session_number,
          guest_count: session.guest_count,
          total_amount: Number(session.total_amount ?? 0),
          customer_type: session.customer_type ?? "客人",
          seat_codes: [...(seatMap.get(session.id) ?? [])].sort(sortSeatCodes),
        }))
      );
      setCashCount(cashData ?? null);
      setOpeningBreakdown(normalizeBreakdown(cashData?.opening_breakdown));
      setOpeningNotesInput(cashData?.opening_notes ?? "");
      setClosingBreakdown(normalizeBreakdown(cashData?.closing_breakdown));
      setClosingNotesInput(cashData?.closing_notes ?? "");
    } catch (error) {
      console.error("Failed to load dashboard", error);
      alert("讀取今日後台失敗");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const paidSessions = useMemo(
    () => sessions.filter((session) => session.payment_status === "paid"),
    [sessions]
  );

  const todayRevenue = useMemo(
    () => paidSessions.reduce((sum, session) => sum + Number(session.total_amount ?? 0), 0),
    [paidSessions]
  );

  const todayGuests = useMemo(
    () => sessions.reduce((sum, session) => sum + Number(session.guest_count ?? 0), 0),
    [sessions]
  );

  const avgTicket = useMemo(() => {
    if (paidSessions.length === 0) return 0;
    return Math.round(todayRevenue / paidSessions.length);
  }, [paidSessions.length, todayRevenue]);

  const complimentaryTotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      if (item.status !== "active" || !item.is_complimentary) return sum;
      return sum + Number(item.line_total ?? 0);
    }, 0);
  }, [orderItems]);

  const topProducts = useMemo(() => {
    const paidIds = new Set(paidSessions.map((item) => item.id));
    const map = new Map<string, { name: string; quantity: number; revenue: number }>();

    for (const item of orderItems) {
      if (!paidIds.has(item.session_id) || item.status !== "active" || item.is_complimentary) {
        continue;
      }

      const current = map.get(item.product_name) ?? {
        name: item.product_name,
        quantity: 0,
        revenue: 0,
      };

      current.quantity += Number(item.quantity ?? 0);
      current.revenue += Number(item.line_total ?? 0);
      map.set(item.product_name, current);
    }

    return [...map.values()].sort((a, b) => b.quantity - a.quantity).slice(0, 6);
  }, [orderItems, paidSessions]);

  const timeBlocks = useMemo<TimeBlock[]>(() => {
    const blocks: TimeBlock[] = [
      { label: "13:00-14:00", startHour: 13, endHour: 14, orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "14:00-15:00", startHour: 14, endHour: 15, orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "15:00-16:00", startHour: 15, endHour: 16, orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "16:00-17:00", startHour: 16, endHour: 17, orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "17:00-18:00", startHour: 17, endHour: 18, orderCount: 0, guestCount: 0, revenue: 0 },
    ];

    for (const session of sessions) {
      if (!session.created_at) continue;
      const createdAt = new Date(session.created_at);
      if (Number.isNaN(createdAt.getTime())) continue;

      const hour = createdAt.getHours();
      const block = blocks.find((item) => hour >= item.startHour && hour < item.endHour);
      if (!block) continue;

      block.orderCount += 1;
      block.guestCount += Number(session.guest_count ?? 0);
      if (session.payment_status === "paid") {
        block.revenue += Number(session.total_amount ?? 0);
      }
    }

    return blocks;
  }, [sessions]);

  const paymentMethodStats = useMemo(() => {
    const stats: Record<string, number> = {};
    for (const session of sessions) {
      const key = session.payment_method || "未填付款方式";
      stats[key] = (stats[key] ?? 0) + 1;
    }
    return Object.entries(stats);
  }, [sessions]);

  const cashPaidTotal = useMemo(() => {
    return paidSessions.reduce((sum, session) => {
      if ((session.payment_method ?? "") !== "現金") return sum;
      return sum + Number(session.total_amount ?? 0);
    }, 0);
  }, [paidSessions]);

  const openingCountedTotal = useMemo(
    () => calculateBreakdownTotal(openingBreakdown),
    [openingBreakdown]
  );

  const closingCountedTotal = useMemo(
    () => calculateBreakdownTotal(closingBreakdown),
    [closingBreakdown]
  );

  const expectedClosingCash = useMemo(() => {
    const openingCash =
      cashCount?.opening_cash != null ? Number(cashCount.opening_cash) : openingCountedTotal;
    return openingCash + cashPaidTotal;
  }, [cashCount?.opening_cash, cashPaidTotal, openingCountedTotal]);

  const closingDifference = useMemo(() => {
    if (cashCount?.closing_cash == null) return null;
    return Number(cashCount.closing_cash) - expectedClosingCash;
  }, [cashCount?.closing_cash, expectedClosingCash]);

  async function saveCashCount(mode: "opening" | "closing") {
    const businessDate = todayIsoDate();
    const cashValue = mode === "opening" ? openingCountedTotal : closingCountedTotal;
    const notesValue = mode === "opening" ? openingNotesInput.trim() : closingNotesInput.trim();

    if (!Number.isFinite(cashValue) || cashValue < 0) {
      alert(mode === "opening" ? "請輸入正確的開店現金" : "請輸入正確的關帳現金");
      return;
    }

    try {
      if (mode === "opening") setIsSavingOpening(true);
      if (mode === "closing") setIsSavingClosing(true);

      const payload =
        mode === "opening"
          ? {
              business_date: businessDate,
              opening_cash: cashValue,
              opening_breakdown: openingBreakdown,
              opening_notes: notesValue || null,
              opening_counted_at: new Date().toISOString(),
            }
          : {
              business_date: businessDate,
              closing_cash: cashValue,
              closing_breakdown: closingBreakdown,
              closing_notes: notesValue || null,
              closing_counted_at: new Date().toISOString(),
            };

      const { data, error } = await supabase
        .from("daily_cash_counts")
        .upsert(payload, { onConflict: "business_date" })
        .select()
        .single();

      if (error) throw error;

      setCashCount(data);
      alert(mode === "opening" ? "已儲存開店現金" : "已儲存關帳現金");
    } catch (error) {
      console.error("Failed to save cash count", error);
      const maybeMessage = error as { message?: string };
      if (maybeMessage?.message?.includes("daily_cash_counts")) {
        alert("請先在 Supabase 執行 supabase/20260408_daily_cash_counts.sql");
        return;
      }
      alert(mode === "opening" ? "儲存開店現金失敗" : "儲存關帳現金失敗");
    } finally {
      if (mode === "opening") setIsSavingOpening(false);
      if (mode === "closing") setIsSavingClosing(false);
    }
  }

  if (isLoading) {
    return <main className="pos-shell p-6 text-slate-600">讀取中...</main>;
  }

  return (
    <main className="pos-shell p-3 md:p-4">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-3">
        <header className="pos-panel rounded-[28px] px-4 py-3 lg:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">
                Live Dashboard
              </p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                <h1 className="text-2xl font-bold text-slate-900 lg:text-3xl">今日後台</h1>
                <p className="text-sm text-slate-500">統計範圍固定為 13:00 到 18:00</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 lg:flex">
              <button
                onClick={() => router.push("/")}
                className="h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-800"
              >
                返回座位
              </button>
              <button
                onClick={() => router.push("/orders")}
                className="h-11 rounded-2xl bg-sky-100 px-4 text-sm font-semibold text-sky-900"
              >
                歷史訂單
              </button>
              <button
                onClick={loadDashboard}
                className="h-11 rounded-2xl bg-amber-100 px-4 text-sm font-semibold text-amber-900"
              >
                重新整理
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 lg:grid-cols-6 lg:gap-3">
            <DashStat label="今日營業額" value={`$${todayRevenue}`} tone="text-emerald-700" />
            <DashStat label="來客數" value={`${todayGuests} 人`} tone="text-sky-700" />
            <DashStat label="訂單數" value={`${sessions.length} 張`} tone="text-violet-700" />
            <DashStat label="平均客單" value={`$${avgTicket}`} tone="text-amber-700" />
            <DashStat label="未結帳" value={`${activeSessions.length} 張`} tone="text-rose-700" />
            <DashStat label="招待總額" value={`$${complimentaryTotal}`} tone="text-orange-700" />
          </div>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("overview")}
              className={`h-11 rounded-2xl px-4 text-sm font-semibold ${
                activeTab === "overview" ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              營運總覽
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("cash")}
              className={`h-11 rounded-2xl px-4 text-sm font-semibold ${
                activeTab === "cash" ? "bg-amber-500 text-white" : "bg-slate-100 text-slate-700"
              }`}
            >
              現金清點
            </button>
          </div>
        </header>

        {activeTab === "overview" ? (
          <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.15fr_0.85fr_0.95fr]">
            <Panel title="未結帳訂單">
              {activeSessions.length === 0 ? (
                <Empty text="目前沒有未結帳訂單" />
              ) : (
                <div className="space-y-3">
                  {activeSessions.map((session) => (
                    <article key={session.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-lg font-bold text-slate-900">{session.session_number}</h3>
                          <p className="text-xs text-slate-500">{formatSeatLabel(session.seat_codes)}</p>
                        </div>
                        <p className="text-lg font-bold text-slate-900">${session.total_amount}</p>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Mini label="來客數" value={`${session.guest_count} 人`} />
                        <Mini label="客人類型" value={session.customer_type ?? "客人"} />
                      </div>
                      <button
                        onClick={() => router.push(`/session/${session.id}`)}
                        className="mt-3 h-10 w-full rounded-2xl bg-sky-500 text-sm font-semibold text-white"
                      >
                        進入訂單
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="熱門商品">
              {topProducts.length === 0 ? (
                <Empty text="今天還沒有商品資料" />
              ) : (
                <div className="space-y-3">
                  {topProducts.map((product, index) => (
                    <div key={product.name} className="rounded-[24px] bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-xs text-slate-500">#{index + 1}</p>
                          <p className="truncate text-lg font-bold text-slate-900">{product.name}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">數量</p>
                          <p className="text-lg font-bold text-slate-900">{product.quantity}</p>
                        </div>
                      </div>
                      <p className="mt-2 text-sm font-semibold text-emerald-700">營收 ${product.revenue}</p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="13:00-18:00 時段分析">
              <div className="space-y-3">
                {timeBlocks.map((block) => (
                  <div key={block.label} className="rounded-[24px] bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900">{block.label}</p>
                      <p className="text-sm font-semibold text-emerald-700">${block.revenue}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Mini label="訂單數" value={`${block.orderCount} 張`} />
                      <Mini label="來客數" value={`${block.guestCount} 人`} />
                    </div>
                  </div>
                ))}

                <div className="rounded-[24px] border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-900">付款方式摘要</h3>
                  <div className="mt-3 space-y-3">
                    {paymentMethodStats.length === 0 ? (
                      <Empty text="尚無付款方式資料" />
                    ) : (
                      paymentMethodStats.map(([method, count]) => (
                        <div key={method}>
                          <div className="mb-1 flex items-center justify-between text-sm">
                            <span className="font-medium text-slate-700">{method}</span>
                            <span className="text-slate-500">{count} 筆</span>
                          </div>
                          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-indigo-500"
                              style={{
                                width: `${(count / Math.max(...paymentMethodStats.map((item) => item[1]), 1)) * 100}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </Panel>
          </section>
        ) : (
          <section className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.32fr_0.68fr]">
            <Panel title="開店與關帳現金">
              <div className="space-y-3">
                <div className="grid gap-3 lg:grid-cols-2">
                  <CashSummaryCard label="開店現金" value={cashCount?.opening_cash != null ? `$${cashCount.opening_cash}` : `$${openingCountedTotal}`} note={formatDateTime(cashCount?.opening_counted_at)} />
                  <CashSummaryCard label="關帳現金" value={cashCount?.closing_cash != null ? `$${cashCount.closing_cash}` : `$${closingCountedTotal}`} note={formatDateTime(cashCount?.closing_counted_at)} />
                </div>

                <div className="grid gap-3 lg:grid-cols-2">
                  <CashEntryCard
                    title="開店現金清點"
                    breakdown={openingBreakdown}
                    notes={openingNotesInput}
                    notesLabel="開店備註"
                    totalLabel={`合計 $${openingCountedTotal}`}
                    buttonLabel={isSavingOpening ? "儲存中..." : "儲存開店現金"}
                    disabled={isSavingOpening}
                    onBreakdownChange={setOpeningBreakdown}
                    onNotesChange={setOpeningNotesInput}
                    onSubmit={() => saveCashCount("opening")}
                  />
                  <CashEntryCard
                    title="關帳現金清點"
                    breakdown={closingBreakdown}
                    notes={closingNotesInput}
                    notesLabel="關帳備註"
                    totalLabel={`合計 $${closingCountedTotal}`}
                    buttonLabel={isSavingClosing ? "儲存中..." : "儲存關帳現金"}
                    disabled={isSavingClosing}
                    onBreakdownChange={setClosingBreakdown}
                    onNotesChange={setClosingNotesInput}
                    onSubmit={() => saveCashCount("closing")}
                  />
                </div>
              </div>
            </Panel>

            <Panel title="現金對帳摘要">
              <div className="space-y-3">
                <CashSummaryCard label="今日現金收款" value={`$${cashPaidTotal}`} note="僅統計付款方式為現金且已付款的訂單" />
                <CashSummaryCard label="系統應有現金" value={`$${expectedClosingCash}`} note="開店現金 + 今日現金收款" />
                <CashSummaryCard
                  label="關帳差額"
                  value={closingDifference == null ? "尚未清點" : `${closingDifference >= 0 ? "+" : ""}$${closingDifference}`}
                  note={
                    closingDifference == null
                      ? "輸入關帳現金後會自動計算"
                      : closingDifference === 0
                        ? "帳目一致"
                        : closingDifference > 0
                          ? "實際現金高於系統預估"
                          : "實際現金低於系統預估"
                  }
                  tone={
                    closingDifference == null
                      ? "text-slate-900"
                      : closingDifference === 0
                        ? "text-emerald-700"
                        : "text-rose-700"
                  }
                />
                <div className="rounded-[24px] bg-slate-50 p-4 text-sm text-slate-600">
                  <p className="font-semibold text-slate-900">建議流程</p>
                  <ul className="mt-2 space-y-2">
                    <li>1. 開店前先輸入開店現金</li>
                    <li>2. 營業中照常使用 POS 收單</li>
                    <li>3. 關帳時輸入實際現金，系統會自動對差額</li>
                  </ul>
                </div>
              </div>
            </Panel>
          </section>
        )}
      </div>
    </main>
  );
}

function DashStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="rounded-[20px] bg-slate-50 px-3 py-3">
      <p className="text-[11px] text-slate-500 lg:text-xs">{label}</p>
      <p className={`mt-1 text-xl font-bold lg:text-2xl ${tone}`}>{value}</p>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pos-panel flex min-h-0 flex-col rounded-[28px] p-3 lg:p-4">
      <h2 className="mb-3 text-xl font-bold text-slate-900">{title}</h2>
      <div className="pos-scroll min-h-0 flex-1 pr-1">{children}</div>
    </section>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-2.5">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-[24px] bg-slate-50 p-4 text-slate-500">{text}</div>;
}

function CashSummaryCard({
  label,
  value,
  note,
  tone = "text-slate-900",
}: {
  label: string;
  value: string;
  note: string;
  tone?: string;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className={`mt-2 text-2xl font-bold ${tone}`}>{value}</p>
      <p className="mt-2 text-sm text-slate-500">{note}</p>
    </div>
  );
}

function CashEntryCard({
  title,
  breakdown,
  notes,
  notesLabel,
  totalLabel,
  buttonLabel,
  disabled,
  onBreakdownChange,
  onNotesChange,
  onSubmit,
}: {
  title: string;
  breakdown: CashBreakdown;
  notes: string;
  notesLabel: string;
  totalLabel: string;
  buttonLabel: string;
  disabled: boolean;
  onBreakdownChange: (value: CashBreakdown) => void;
  onNotesChange: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-white p-4">
      <h3 className="text-lg font-bold text-slate-900">{title}</h3>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {CASH_DENOMINATIONS.map((denomination) => {
          const key = String(denomination);
          const count = breakdown[key] ?? 0;
          return (
            <label key={key} className="block rounded-2xl bg-slate-50 p-3">
              <span className="text-sm font-semibold text-slate-700">${denomination}</span>
              <input
                type="number"
                min="0"
                inputMode="numeric"
                value={count === 0 ? "" : String(count)}
                onChange={(event) => {
                  const numericValue = Math.max(0, Math.floor(Number(event.target.value || 0)));
                  onBreakdownChange({
                    ...breakdown,
                    [key]: Number.isFinite(numericValue) ? numericValue : 0,
                  });
                }}
                className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-center text-lg font-semibold tabular-nums text-slate-900 outline-none transition focus:border-amber-400"
                placeholder="0"
              />
              <p className="mt-2 text-xs text-slate-500">小計 ${denomination * count}</p>
            </label>
          );
        })}
      </div>
      <div className="mt-4 rounded-2xl bg-amber-50 px-4 py-3">
        <p className="text-sm text-amber-800">{totalLabel}</p>
      </div>
      <label className="mt-3 block">
        <span className="text-sm text-slate-500">{notesLabel}</span>
        <textarea
          value={notes}
          onChange={(event) => onNotesChange(event.target.value)}
          rows={3}
          className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 focus:bg-white"
          placeholder="例如：含找零零錢、換鈔、臨時支出"
        />
      </label>
      <button
        type="button"
        onClick={onSubmit}
        disabled={disabled}
        className="mt-4 h-12 w-full rounded-2xl bg-amber-500 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {buttonLabel}
      </button>
    </div>
  );
}
