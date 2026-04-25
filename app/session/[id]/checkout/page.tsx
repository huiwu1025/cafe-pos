"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type SessionData = {
  id: string;
  session_number: string;
  guest_count: number;
  order_status: string;
  payment_status: string;
  payment_method?: string | null;
  subtotal_amount: number;
  discount_amount: number;
  total_amount: number;
  customer_type?: string | null;
  customer_label?: string | null;
  tip_amount?: number | null;
  amount_received?: number | null;
  change_amount?: number | null;
  created_at?: string | null;
  paid_at?: string | null;
};

type OrderItem = {
  id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  note: string | null;
  custom_note: string | null;
  is_complimentary?: boolean | null;
  is_served?: boolean | null;
};

type PaymentSplit = {
  id: string;
  splitLabel: string;
  paymentMethod: string;
  amount: string;
  amountReceived: string;
};

type SessionPaymentSplitRow = {
  id: string;
  split_label: string | null;
  payment_method: string;
  amount: number | null;
  amount_received: number | null;
  sort_order: number | null;
};

const PAYMENT_METHOD_OPTIONS = ["現金", "歐付寶", "其他"];
const MIN_CHECKOUT_RULE_START = "2026-04-17";
const MIN_CHECKOUT_AMOUNT = 100;

function safeNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatDateToTaipeiIso(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function createSplitRow(index: number, amount = 0, paymentMethod = "現金"): PaymentSplit {
  return {
    id: `local-${index}-${Math.random().toString(36).slice(2, 8)}`,
    splitLabel: `第 ${index + 1} 筆`,
    paymentMethod,
    amount: amount > 0 ? String(amount) : "",
    amountReceived: amount > 0 ? String(amount) : "",
  };
}

export default function SessionCheckoutPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [session, setSession] = useState<SessionData | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [splits, setSplits] = useState<PaymentSplit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const loadPage = useCallback(async () => {
    const { data: sessionData, error: sessionError } = await supabase
      .from("dining_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (sessionError) throw sessionError;

    const { data: itemsData, error: itemsError } = await supabase
      .from("order_items")
      .select("*")
      .eq("session_id", sessionId)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (itemsError) throw itemsError;

    const { data: splitData, error: splitError } = await supabase
      .from("session_payment_splits")
      .select("*")
      .eq("session_id", sessionId)
      .order("sort_order", { ascending: true });

    if (splitError && !splitError.message?.includes("session_payment_splits")) {
      throw splitError;
    }

    setSession(sessionData);
    setOrderItems((itemsData ?? []) as OrderItem[]);

    const existingSplits = ((splitData ?? []) as SessionPaymentSplitRow[]).map((row, index) => ({
      id: row.id,
      splitLabel: row.split_label ?? `第 ${index + 1} 筆`,
      paymentMethod: row.payment_method || "現金",
      amount: String(Number(row.amount ?? 0)),
      amountReceived: String(Number(row.amount_received ?? row.amount ?? 0)),
    }));

    if (existingSplits.length > 0) {
      setSplits(existingSplits);
    } else {
      const total = Math.max(Number(sessionData.total_amount ?? 0), 0);
      const defaultMethod = sessionData.payment_method ?? "現金";
      setSplits([createSplitRow(0, total, defaultMethod)]);
    }
  }, [sessionId]);

  useEffect(() => {
    async function run() {
      try {
        setIsLoading(true);
        await loadPage();
      } catch (error) {
        console.error("Failed to load checkout page", error);
        alert("讀取結帳頁失敗");
      } finally {
        setIsLoading(false);
      }
    }

    void run();
  }, [loadPage]);

  const itemsSubtotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      if (item.is_complimentary) return sum;
      return sum + safeNumber(item.line_total);
    }, 0);
  }, [orderItems]);

  const tipAmount = useMemo(() => safeNumber(session?.tip_amount ?? 0), [session?.tip_amount]);
  const discountAmount = useMemo(() => safeNumber(session?.discount_amount ?? 0), [session?.discount_amount]);
  const finalTotal = useMemo(() => Math.max(Number(session?.total_amount ?? 0), 0), [session?.total_amount]);
  const splitAmountTotal = useMemo(
    () => splits.reduce((sum, split) => sum + safeNumber(split.amount), 0),
    [splits]
  );
  const splitReceivedTotal = useMemo(
    () => splits.reduce((sum, split) => sum + safeNumber(split.amountReceived), 0),
    [splits]
  );
  const splitChangeTotal = useMemo(
    () =>
      splits.reduce((sum, split) => {
        const amount = safeNumber(split.amount);
        const received = safeNumber(split.amountReceived);
        return sum + Math.max(received - amount, 0);
      }, 0),
    [splits]
  );

  const sessionBusinessDate = useMemo(
    () => formatDateToTaipeiIso(session?.created_at ?? null),
    [session?.created_at]
  );
  const isMinimumSpendRuleActive = useMemo(
    () => sessionBusinessDate >= MIN_CHECKOUT_RULE_START,
    [sessionBusinessDate]
  );
  const isAllComplimentaryOrder = useMemo(
    () => orderItems.length > 0 && orderItems.every((item) => Boolean(item.is_complimentary)),
    [orderItems]
  );
  const minimumSpendShortfall = useMemo(() => {
    if (!isMinimumSpendRuleActive || isAllComplimentaryOrder) return 0;
    return Math.max(MIN_CHECKOUT_AMOUNT - finalTotal, 0);
  }, [finalTotal, isAllComplimentaryOrder, isMinimumSpendRuleActive]);

  function updateSplit(splitId: string, field: keyof PaymentSplit, value: string) {
    setSplits((prev) =>
      prev.map((split) => (split.id === splitId ? { ...split, [field]: value } : split))
    );
  }

  function addSplit() {
    setSplits((prev) => [...prev, createSplitRow(prev.length, 0, "現金")]);
  }

  function removeSplit(splitId: string) {
    setSplits((prev) => (prev.length <= 1 ? prev : prev.filter((split) => split.id !== splitId)));
  }

  async function confirmCheckout() {
    if (!session) return;

    if (minimumSpendShortfall > 0) {
      alert(`本單未達低消 ${MIN_CHECKOUT_AMOUNT} 元，還差 ${minimumSpendShortfall} 元`);
      return;
    }

    if (Math.round(splitAmountTotal) !== Math.round(finalTotal)) {
      alert(`分帳總額需等於總計 ${finalTotal} 元，目前為 ${splitAmountTotal} 元`);
      return;
    }

    for (const split of splits) {
      const amount = safeNumber(split.amount);
      const received = safeNumber(split.amountReceived);
      if (received < amount) {
        alert(`「${split.splitLabel || "分帳"}」實收不足`);
        return;
      }
    }

    try {
      setIsSaving(true);

      const normalizedSplits = splits.map((split, index) => {
        const amount = safeNumber(split.amount);
        const amountReceived = safeNumber(split.amountReceived);
        return {
          session_id: sessionId,
          split_label: split.splitLabel.trim() || null,
          payment_method: split.paymentMethod,
          amount,
          amount_received: amountReceived,
          change_amount: Math.max(amountReceived - amount, 0),
          sort_order: index,
        };
      });

      const { error: deleteError } = await supabase
        .from("session_payment_splits")
        .delete()
        .eq("session_id", sessionId);

      if (deleteError && !deleteError.message?.includes("session_payment_splits")) {
        throw deleteError;
      }

      if (normalizedSplits.length > 0) {
        const { error: insertError } = await supabase
          .from("session_payment_splits")
          .insert(normalizedSplits);

        if (insertError) throw insertError;
      }

      const paymentMethodLabel = [...new Set(normalizedSplits.map((split) => split.payment_method))].join(" / ");
      const { error: updateError } = await supabase
        .from("dining_sessions")
        .update({
          payment_status: "paid",
          order_status: "closed",
          payment_method: paymentMethodLabel || session.payment_method || "現金",
          amount_received: splitReceivedTotal,
          change_amount: splitChangeTotal,
          paid_at: new Date().toISOString(),
        })
        .eq("id", sessionId);

      if (updateError) throw updateError;

      alert("已完成結帳");
      router.push(`/session/${sessionId}`);
      router.refresh();
    } catch (error) {
      console.error("Failed to confirm checkout", error);
      const maybeMessage = error as { message?: string };
      if (maybeMessage?.message?.includes("session_payment_splits")) {
        alert("請先在 Supabase 執行 supabase/20260425_session_payment_splits.sql");
        return;
      }
      alert("結帳失敗");
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return <main className="pos-shell p-6 text-slate-600">讀取中...</main>;
  }

  if (!session) {
    return <main className="pos-shell p-6 text-slate-600">找不到主單</main>;
  }

  return (
    <main className="pos-shell p-3 md:p-4">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-3">
        <header className="pos-panel rounded-[28px] px-4 py-3 lg:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-emerald-700">Checkout Desk</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 lg:text-3xl">結帳頁面</h1>
              <p className="mt-1 text-sm text-slate-500">{session.session_number}</p>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:flex">
              <button
                type="button"
                onClick={() => router.push(`/session/${sessionId}`)}
                className="h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-700"
              >
                返回主單
              </button>
              <button
                type="button"
                onClick={confirmCheckout}
                disabled={isSaving || session.payment_status === "paid"}
                className="h-11 rounded-2xl bg-emerald-500 px-4 text-sm font-semibold text-white disabled:opacity-50"
              >
                {session.payment_status === "paid" ? "已結帳" : isSaving ? "結帳中..." : "確認結帳"}
              </button>
            </div>
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="pos-panel flex min-h-0 flex-col rounded-[28px] p-4">
            <h2 className="mb-3 text-xl font-bold text-slate-900">訂單總覽</h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryCard label="來客數" value={`${session.guest_count} 人`} />
              <SummaryCard label="餐點小計" value={`$${itemsSubtotal}`} />
              <SummaryCard label="折扣" value={`$${discountAmount}`} />
              <SummaryCard label="小費" value={`$${tipAmount}`} />
            </div>

            <div className="mt-3 rounded-[24px] border border-slate-200 bg-white p-4">
              {orderItems.length === 0 ? (
                <p className="text-sm text-slate-500">目前沒有品項</p>
              ) : (
                <div className="space-y-3">
                  {orderItems.map((item) => (
                    <div key={item.id} className="rounded-2xl bg-slate-50 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-lg font-bold text-slate-900">{item.product_name}</p>
                          <p className="text-sm text-slate-500">
                            ${Number(item.unit_price)} × {item.quantity}
                            {item.is_complimentary ? " / 招待" : ""}
                            {item.is_served ? " / 已出餐" : ""}
                          </p>
                          {(item.custom_note || item.note) && (
                            <p className="mt-1 text-sm text-slate-500">{item.custom_note || item.note}</p>
                          )}
                        </div>
                        <p className="text-lg font-bold text-slate-900">
                          ${item.is_complimentary ? 0 : Number(item.line_total)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <section className="pos-panel flex min-h-0 flex-col rounded-[28px] p-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-xl font-bold text-slate-900">分開結帳</h2>
              <button
                type="button"
                onClick={addSplit}
                disabled={session.payment_status === "paid"}
                className="h-10 rounded-2xl bg-sky-100 px-4 text-sm font-semibold text-sky-900 disabled:opacity-50"
              >
                新增一筆分帳
              </button>
            </div>

            {minimumSpendShortfall > 0 && (
              <div className="mt-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
                本單未達低消 {MIN_CHECKOUT_AMOUNT} 元，還差 ${minimumSpendShortfall}
              </div>
            )}

            {isAllComplimentaryOrder && (
              <div className="mt-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                本單全招待，可直接結帳
              </div>
            )}

            <div className="pos-scroll mt-3 flex-1 space-y-3 pr-1">
              {splits.map((split, index) => {
                const amount = safeNumber(split.amount);
                const amountReceived = safeNumber(split.amountReceived);
                const changeAmount = Math.max(amountReceived - amount, 0);

                return (
                  <div key={split.id} className="rounded-[24px] border border-slate-200 bg-white p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <label className="block">
                        <span className="mb-2 block text-sm text-slate-500">分帳名稱</span>
                        <input
                          type="text"
                          value={split.splitLabel}
                          onChange={(event) => updateSplit(split.id, "splitLabel", event.target.value)}
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-emerald-400"
                          placeholder={`第 ${index + 1} 筆`}
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm text-slate-500">付款方式</span>
                        <select
                          value={split.paymentMethod}
                          onChange={(event) => updateSplit(split.id, "paymentMethod", event.target.value)}
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-emerald-400"
                        >
                          {PAYMENT_METHOD_OPTIONS.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm text-slate-500">應收金額</span>
                        <input
                          type="number"
                          min="0"
                          value={split.amount}
                          onChange={(event) => updateSplit(split.id, "amount", event.target.value)}
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-emerald-400"
                        />
                      </label>

                      <label className="block">
                        <span className="mb-2 block text-sm text-slate-500">實收金額</span>
                        <input
                          type="number"
                          min="0"
                          value={split.amountReceived}
                          onChange={(event) => updateSplit(split.id, "amountReceived", event.target.value)}
                          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm outline-none focus:border-emerald-400"
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-700">找零 ${changeAmount}</p>
                      <button
                        type="button"
                        onClick={() => removeSplit(split.id)}
                        disabled={splits.length <= 1 || session.payment_status === "paid"}
                        className="h-10 rounded-2xl bg-rose-100 px-4 text-sm font-semibold text-rose-700 disabled:opacity-50"
                      >
                        刪除此分帳
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 rounded-[24px] bg-slate-50 px-4 py-4">
              <div className="flex justify-between text-sm text-slate-600">
                <span>總計</span>
                <span>${finalTotal}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm text-slate-600">
                <span>分帳合計</span>
                <span>${splitAmountTotal}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm text-slate-600">
                <span>實收合計</span>
                <span>${splitReceivedTotal}</span>
              </div>
              <div className="mt-2 flex justify-between text-sm text-slate-600">
                <span>找零合計</span>
                <span>${splitChangeTotal}</span>
              </div>
              <div className="mt-3 border-t border-slate-200 pt-3 text-sm font-semibold text-slate-900">
                尚差 ${Math.max(finalTotal - splitAmountTotal, 0)}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[20px] bg-slate-50 px-4 py-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-bold text-slate-900">{value}</p>
    </div>
  );
}
