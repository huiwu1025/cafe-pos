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
  subtotal_amount: number;
  discount_amount: number;
  total_amount: number;
  tip_amount?: number | null;
  amount_received?: number | null;
  change_amount?: number | null;
  customer_type?: string | null;
  customer_label?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
};

type OrderItemRow = {
  id: string;
  session_id: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  note?: string | null;
  custom_note?: string | null;
  status: string;
  is_complimentary?: boolean | null;
  created_at?: string | null;
};

type SessionSeatRow = {
  session_id: string;
  seats:
    | {
        seat_code: string;
      }
    | {
        seat_code: string;
      }[]
    | null;
};

type ActiveSessionCard = {
  id: string;
  session_number: string;
  guest_count: number;
  total_amount: number;
  customer_type?: string | null;
  customer_label?: string | null;
  seat_codes: string[];
  created_at?: string | null;
};

type TimeSlotStat = {
  label: string;
  orderCount: number;
  guestCount: number;
  revenue: number;
};

export default function DashboardPage() {
  const router = useRouter();

  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    try {
      setIsLoading(true);

      const todayStart = getTodayStart();
      const tomorrowStart = getTomorrowStart();

      const { data: sessionsData, error: sessionsError } = await supabase
        .from("dining_sessions")
        .select("*")
        .gte("created_at", todayStart)
        .lt("created_at", tomorrowStart)
        .order("created_at", { ascending: false });

      if (sessionsError) throw sessionsError;

      const todaySessionIds = (sessionsData ?? []).map((s) => s.id);

      let itemsData: OrderItemRow[] = [];
      if (todaySessionIds.length > 0) {
        const { data, error: itemsError } = await supabase
          .from("order_items")
          .select("*")
          .in("session_id", todaySessionIds);

        if (itemsError) throw itemsError;
        itemsData = data ?? [];
      }

      const { data: activeSessionData, error: activeSessionError } = await supabase
        .from("dining_sessions")
        .select("*")
        .eq("order_status", "open")
        .eq("payment_status", "unpaid")
        .order("created_at", { ascending: false });

      if (activeSessionError) throw activeSessionError;

      const activeSessionIds = (activeSessionData ?? []).map((s) => s.id);
      let seatMap = new Map<string, string[]>();

      if (activeSessionIds.length > 0) {
        const { data: seatData, error: seatError } = await supabase
          .from("session_seats")
          .select(`
            session_id,
            seats:seat_id (
              seat_code
            )
          `)
          .in("session_id", activeSessionIds);

        if (seatError) throw seatError;
        seatMap = buildSeatMap((seatData ?? []) as SessionSeatRow[]);
      }

      const nextActiveSessions: ActiveSessionCard[] = (activeSessionData ?? []).map(
        (session) => ({
          id: session.id,
          session_number: session.session_number,
          guest_count: session.guest_count,
          total_amount: Number(session.total_amount ?? 0),
          customer_type: session.customer_type ?? "客人",
          customer_label: session.customer_label ?? "",
          seat_codes: sortSeatCodes(seatMap.get(session.id) ?? []),
          created_at: session.created_at,
        })
      );

      setSessions(sessionsData ?? []);
      setOrderItems(itemsData);
      setActiveSessions(nextActiveSessions);
    } catch (error) {
      console.error("載入 dashboard 失敗：", error);
      alert("載入 dashboard 失敗");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  function getTodayStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }

  function getTomorrowStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
  }

  function buildSeatMap(rows: SessionSeatRow[]) {
    const seatMap = new Map<string, string[]>();

    for (const row of rows) {
      const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
      if (!seat?.seat_code) continue;

      const existing = seatMap.get(row.session_id) ?? [];
      existing.push(seat.seat_code);
      seatMap.set(row.session_id, existing);
    }

    return seatMap;
  }

  function sortSeatCodes(codes: string[]) {
    return [...codes].sort((a, b) => {
      const aIsBar = a.startsWith("A");
      const bIsBar = b.startsWith("A");
      if (aIsBar && bIsBar) {
        return Number(a.replace("A", "")) - Number(b.replace("A", ""));
      }
      return a.localeCompare(b);
    });
  }

  function formatSeatLabel(seatCodes: string[]) {
    if (seatCodes.length === 0) return "—";
    const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
    if (isAllBar) return seatCodes.join("、");
    return seatCodes.map((seat) => `${seat}桌`).join("、");
  }

  function formatDateTime(value?: string | null) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("zh-TW", { hour12: false });
  }

  const paidSessionsToday = useMemo(() => {
    return sessions.filter((session) => session.payment_status === "paid");
  }, [sessions]);

  const openSessionsToday = useMemo(() => {
    return sessions.filter(
      (session) =>
        session.order_status === "open" && session.payment_status === "unpaid"
    );
  }, [sessions]);

  const todayRevenue = useMemo(() => {
    return paidSessionsToday.reduce(
      (sum, session) => sum + Number(session.total_amount ?? 0),
      0
    );
  }, [paidSessionsToday]);

  const todayGuestCount = useMemo(() => {
    return sessions.reduce((sum, session) => sum + Number(session.guest_count ?? 0), 0);
  }, [sessions]);

  const avgTicket = useMemo(() => {
    if (paidSessionsToday.length === 0) return 0;
    return Math.round(todayRevenue / paidSessionsToday.length);
  }, [paidSessionsToday.length, todayRevenue]);

  const todayTipTotal = useMemo(() => {
    return sessions.reduce((sum, session) => sum + Number(session.tip_amount ?? 0), 0);
  }, [sessions]);

  const paymentMethodStats = useMemo(() => {
    const stats: Record<string, number> = {};

    for (const session of sessions) {
      const key = session.payment_method || "未設定";
      stats[key] = (stats[key] ?? 0) + 1;
    }

    return stats;
  }, [sessions]);

  const customerTypeStats = useMemo(() => {
    const stats: Record<string, number> = {
      客人: 0,
      朋友: 0,
      熟客: 0,
      粉絲: 0,
    };

    for (const session of sessions) {
      const key = session.customer_type ?? "客人";
      stats[key] = (stats[key] ?? 0) + 1;
    }

    return stats;
  }, [sessions]);

  const todayComplimentaryTotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      if (item.status !== "active") return sum;
      if (!item.is_complimentary) return sum;
      return sum + Number(item.line_total ?? 0);
    }, 0);
  }, [orderItems]);

  const topProducts = useMemo(() => {
    const paidSessionIds = new Set(paidSessionsToday.map((session) => session.id));
    const map = new Map<string, { product_name: string; quantity: number; revenue: number }>();

    for (const item of orderItems) {
      if (!paidSessionIds.has(item.session_id)) continue;
      if (item.status !== "active") continue;
      if (item.is_complimentary) continue;

      const existing = map.get(item.product_name) ?? {
        product_name: item.product_name,
        quantity: 0,
        revenue: 0,
      };

      existing.quantity += Number(item.quantity ?? 0);
      existing.revenue += Number(item.line_total ?? 0);
      map.set(item.product_name, existing);
    }

    return [...map.values()]
      .sort((a, b) => {
        if (b.quantity !== a.quantity) return b.quantity - a.quantity;
        return b.revenue - a.revenue;
      })
      .slice(0, 8);
  }, [orderItems, paidSessionsToday]);

  const timeSlotStats = useMemo(() => {
    const slots: TimeSlotStat[] = [
      { label: "00:00–11:59", orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "12:00–13:59", orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "14:00–15:59", orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "16:00–17:59", orderCount: 0, guestCount: 0, revenue: 0 },
      { label: "18:00–23:59", orderCount: 0, guestCount: 0, revenue: 0 },
    ];

    for (const session of sessions) {
      if (!session.created_at) continue;

      const date = new Date(session.created_at);
      if (Number.isNaN(date.getTime())) continue;

      const hour = date.getHours();
      let index = 0;
      if (hour >= 12 && hour < 14) index = 1;
      else if (hour >= 14 && hour < 16) index = 2;
      else if (hour >= 16 && hour < 18) index = 3;
      else if (hour >= 18) index = 4;

      slots[index].orderCount += 1;
      slots[index].guestCount += Number(session.guest_count ?? 0);
      if (session.payment_status === "paid") {
        slots[index].revenue += Number(session.total_amount ?? 0);
      }
    }

    return slots;
  }, [sessions]);

  if (isLoading) {
    return <main className="pos-shell p-6 text-lg text-slate-600">載入中...</main>;
  }

  return (
    <main className="pos-shell p-3 md:p-4">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-3 lg:gap-4">
        <header className="pos-panel rounded-[30px] px-4 py-4 lg:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.24em] text-emerald-700">
                Live Dashboard
              </p>
              <h1 className="mt-2 text-3xl font-bold text-slate-900 lg:text-4xl">今日後台</h1>
              <p className="mt-2 text-base text-slate-500">
                每個面板各自滾動，主畫面維持固定高度
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:flex">
              <button
                onClick={() => router.push("/")}
                className="min-h-[58px] rounded-2xl bg-slate-100 px-5 text-base font-semibold text-slate-800 transition hover:bg-slate-200"
              >
                返回座位
              </button>
              <button
                onClick={() => router.push("/orders")}
                className="min-h-[58px] rounded-2xl bg-sky-100 px-5 text-base font-semibold text-sky-900 transition hover:bg-sky-200"
              >
                歷史訂單
              </button>
              <button
                onClick={loadDashboard}
                className="min-h-[58px] rounded-2xl bg-amber-100 px-5 text-base font-semibold text-amber-900 transition hover:bg-amber-200"
              >
                重新整理
              </button>
            </div>
          </div>
        </header>

        <section className="grid grid-cols-2 gap-3 xl:grid-cols-6">
          {[
            { label: "今日營業額", value: `$${todayRevenue}`, tone: "text-emerald-700" },
            { label: "來客數", value: `${todayGuestCount} 人`, tone: "text-sky-700" },
            { label: "訂單數", value: `${sessions.length} 張`, tone: "text-violet-700" },
            { label: "平均客單", value: `$${avgTicket}`, tone: "text-amber-700" },
            { label: "未結帳", value: `${openSessionsToday.length} 張`, tone: "text-rose-700" },
            { label: "招待總額", value: `$${todayComplimentaryTotal}`, tone: "text-orange-700" },
          ].map((item) => (
            <div key={item.label} className="pos-panel rounded-[28px] px-4 py-4 lg:px-5">
              <p className="text-sm text-slate-500">{item.label}</p>
              <p className={`mt-3 text-3xl font-bold ${item.tone}`}>{item.value}</p>
            </div>
          ))}
        </section>

        <section className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[1.15fr_0.85fr_0.85fr] 2xl:grid-cols-[1.2fr_0.8fr_0.8fr]">
          <div className="grid min-h-0 gap-3 lg:grid-rows-2">
            <Panel title="未結帳訂單" subtitle={`共 ${activeSessions.length} 張`}>
              {activeSessions.length === 0 ? (
                <EmptyState text="目前沒有未結帳訂單" />
              ) : (
                <div className="space-y-3">
                  {activeSessions.map((session) => (
                    <article
                      key={session.id}
                      className="rounded-[24px] border border-slate-200 bg-white p-4"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-xl font-bold text-slate-900">
                            {session.session_number}
                          </h3>
                          <p className="mt-1 text-sm text-slate-500">
                            {formatDateTime(session.created_at)}
                          </p>
                        </div>
                        <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                          open
                        </span>
                      </div>

                      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                        <MiniMetric label="座位" value={formatSeatLabel(session.seat_codes)} />
                        <MiniMetric label="來客數" value={`${session.guest_count} 人`} />
                        <MiniMetric label="客群" value={session.customer_type ?? "客人"} />
                        <MiniMetric
                          label="金額"
                          value={`$${Number(session.total_amount ?? 0)}`}
                        />
                      </div>

                      <button
                        onClick={() => router.push(`/session/${session.id}`)}
                        className="mt-4 w-full rounded-2xl bg-sky-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-sky-600"
                      >
                        進入訂單
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="熱門商品" subtitle="只計已付款且非招待">
              {topProducts.length === 0 ? (
                <EmptyState text="今天還沒有商品資料" />
              ) : (
                <div className="space-y-3">
                  {topProducts.map((product, index) => (
                    <div key={product.product_name} className="rounded-[24px] bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm text-slate-500">#{index + 1}</p>
                          <p className="truncate text-lg font-bold text-slate-900">
                            {product.product_name}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-slate-500">數量</p>
                          <p className="text-lg font-bold text-slate-900">{product.quantity}</p>
                        </div>
                      </div>
                      <p className="mt-3 text-sm font-medium text-emerald-700">
                        營收 ${product.revenue}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <div className="grid min-h-0 gap-3 lg:grid-rows-[0.95fr_1.05fr]">
            <Panel title="付款方式分布" subtitle={`更新於 ${new Date().toLocaleTimeString("zh-TW", { hour12: false })}`}>
              <div className="space-y-4">
                {Object.keys(paymentMethodStats).length === 0 ? (
                  <EmptyState text="今天還沒有付款方式資料" />
                ) : (
                  Object.entries(paymentMethodStats).map(([method, count]) => {
                    const width = `${(count / Math.max(...Object.values(paymentMethodStats), 1)) * 100}%`;

                    return (
                      <div key={method}>
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{method}</span>
                          <span className="text-slate-500">{count} 筆</span>
                        </div>
                        <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-indigo-500"
                            style={{ width }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </Panel>

            <Panel title="客人類型分布" subtitle="依今日訂單統計">
              <div className="space-y-4">
                {Object.entries(customerTypeStats).map(([type, count]) => {
                  const percentage =
                    sessions.length === 0 ? 0 : Math.round((count / sessions.length) * 100);

                  return (
                    <div key={type}>
                      <div className="mb-2 flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-700">{type}</span>
                        <span className="text-slate-500">
                          {count} 組 / {percentage}%
                        </span>
                      </div>
                      <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-amber-400"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}

                <div className="grid grid-cols-2 gap-3 pt-2">
                  <MiniMetric label="今日小費" value={`$${todayTipTotal}`} />
                  <MiniMetric label="已付款" value={`${paidSessionsToday.length} 張`} />
                </div>
              </div>
            </Panel>
          </div>

          <div className="grid min-h-0 gap-3 lg:grid-rows-[0.9fr_1.1fr]">
            <Panel title="時段營業統計" subtitle="依建立訂單時間分段">
              <div className="space-y-3">
                {timeSlotStats.map((slot) => (
                  <div key={slot.label} className="rounded-[24px] bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-700">{slot.label}</p>
                      <p className="text-sm text-slate-500">${slot.revenue}</p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                      <MiniMetric label="訂單" value={`${slot.orderCount} 張`} />
                      <MiniMetric label="來客" value={`${slot.guestCount} 人`} />
                    </div>
                  </div>
                ))}
              </div>
            </Panel>

            <Panel title="快速摘要" subtitle="讓店內管理一眼可判斷">
              <div className="grid gap-3">
                <SummaryCard
                  label="更新時間"
                  value={new Date().toLocaleString("zh-TW", { hour12: false })}
                />
                <SummaryCard label="未結帳張數" value={`${openSessionsToday.length} 張`} />
                <SummaryCard label="平均客單" value={`$${avgTicket}`} />
                <SummaryCard label="最熱門商品" value={topProducts[0]?.product_name ?? "—"} />
                <SummaryCard label="招待總額" value={`$${todayComplimentaryTotal}`} />
              </div>
            </Panel>
          </div>
        </section>
      </div>
    </main>
  );
}

function Panel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section className="pos-panel flex min-h-0 flex-col rounded-[32px] p-4 lg:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
        </div>
      </div>
      <div className="pos-scroll min-h-0 flex-1 pr-1">{children}</div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-white px-3 py-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-2 text-base font-semibold text-slate-900">{value}</p>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[24px] bg-slate-50 px-4 py-4">
      <p className="text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="rounded-[24px] bg-slate-50 p-5 text-slate-500">{text}</div>;
}
