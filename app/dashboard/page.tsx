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

export default function DashboardPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItemRow[]>([]);
  const [activeSessions, setActiveSessions] = useState<ActiveSessionCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    try {
      setIsLoading(true);

      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const tomorrowStart = new Date(todayStart);
      tomorrowStart.setDate(tomorrowStart.getDate() + 1);

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
        const { data, error } = await supabase
          .from("order_items")
          .select("*")
          .in("session_id", sessionIds);

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
          .select(`
            session_id,
            seats:seat_id (
              seat_code
            )
          `)
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
    } catch (error) {
      console.error("載入今日後台失敗：", error);
      alert("載入今日後台失敗");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  function sortSeatCodes(a: string, b: string) {
    const aIsBar = a.startsWith("A");
    const bIsBar = b.startsWith("A");
    if (aIsBar && bIsBar) return Number(a.replace("A", "")) - Number(b.replace("A", ""));
    return a.localeCompare(b);
  }

  function formatSeatLabel(seatCodes: string[]) {
    if (seatCodes.length === 0) return "—";
    const isAllBar = seatCodes.every((seat) => seat.startsWith("A"));
    if (isAllBar) return seatCodes.join("、");
    return seatCodes.map((seat) => `${seat}桌`).join("、");
  }

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
      const key = session.payment_method || "未設定";
      stats[key] = (stats[key] ?? 0) + 1;
    }
    return Object.entries(stats);
  }, [sessions]);

  if (isLoading) {
    return <main className="pos-shell p-6 text-slate-600">載入中...</main>;
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
                <p className="text-sm text-slate-500">下午 13:00 到 18:00 的營運監看</p>
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
        </header>

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
                      <Mini label="客類" value={session.customer_type ?? "客人"} />
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
                    <p className="mt-2 text-sm font-semibold text-emerald-700">
                      營收 ${product.revenue}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="13:00-18:00 來客時段分析">
            <div className="space-y-3">
              {timeBlocks.map((block) => (
                <div key={block.label} className="rounded-[24px] bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-900">{block.label}</p>
                    <p className="text-sm font-semibold text-emerald-700">${block.revenue}</p>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Mini label="訂單" value={`${block.orderCount} 張`} />
                    <Mini label="來客" value={`${block.guestCount} 人`} />
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
