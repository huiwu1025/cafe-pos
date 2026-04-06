"use client";

import { useEffect, useMemo, useState } from "react";
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
};

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
  sort_order: number;
};

type OrderItem = {
  id: string;
  session_id: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  note: string | null;
  custom_note: string | null;
  status: string;
  is_complimentary?: boolean | null;
};

const CUSTOMER_TYPES = ["客人", "朋友", "熟客", "粉絲"];
const TEMP_OPTIONS = ["冰", "涼", "熱"];
const SUGAR_OPTIONS = ["兩倍糖", "正常", "少糖", "無糖"];
const EXTRA_OPTIONS = ["去冰", "加珍珠", "燕麥奶"];
const PAYMENT_METHOD_OPTIONS = ["現金", "歐付寶", "其他"];

const ORDER_ITEMS_PER_PAGE = 5;

export default function SessionPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [session, setSession] = useState<SessionData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [isPaying, setIsPaying] = useState(false);
  const [isDeletingSession, setIsDeletingSession] = useState(false);

  const [selectedTemp, setSelectedTemp] = useState("冰");
  const [selectedSugar, setSelectedSugar] = useState("正常");
  const [selectedExtras, setSelectedExtras] = useState<string[]>([]);

  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  const [customerLabel, setCustomerLabel] = useState("");
  const [isSavingCustomerLabel, setIsSavingCustomerLabel] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState("現金");
  const [isSavingPaymentMethod, setIsSavingPaymentMethod] = useState(false);

  const [tipAmountInput, setTipAmountInput] = useState("0");
  const [isSavingTip, setIsSavingTip] = useState(false);

  const [amountReceivedInput, setAmountReceivedInput] = useState("");
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);

  const [activeCategory, setActiveCategory] = useState("");
  const [orderPage, setOrderPage] = useState(1);

  const isLocked = session?.payment_status === "paid";

  useEffect(() => {
    if (!sessionId) return;
    void init();
  }, [sessionId]);

  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    for (const item of orderItems) {
      nextDrafts[item.id] = item.custom_note ?? "";
    }
    setNoteDrafts(nextDrafts);
  }, [orderItems]);

  async function init() {
    try {
      setIsLoading(true);
      await Promise.all([loadSession(), loadProducts(), loadOrderItems()]);
    } catch (error) {
      console.error("初始化訂單頁失敗：", error);
      alert("載入訂單頁失敗，請查看 console");
    } finally {
      setIsLoading(false);
    }
  }

  async function loadSession() {
    const { data, error } = await supabase
      .from("dining_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error) throw error;

    setSession(data);
    setCustomerLabel(data.customer_label ?? "");
    setPaymentMethod(data.payment_method ?? "現金");
    setTipAmountInput(String(Number(data.tip_amount ?? 0)));
    setAmountReceivedInput(
      data.amount_received !== null && data.amount_received !== undefined
        ? String(Number(data.amount_received))
        : ""
    );
  }

  async function loadProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const nextProducts = data ?? [];
    setProducts(nextProducts);

    if (nextProducts.length > 0) {
      const firstCategory = nextProducts[0]?.category ?? "";
      setActiveCategory((prev) => prev || firstCategory);
    }
  }

  async function loadOrderItems() {
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .eq("session_id", sessionId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error) throw error;

    const nextItems = data ?? [];
    setOrderItems(nextItems);

    const nextPages = Math.max(1, Math.ceil(nextItems.length / ORDER_ITEMS_PER_PAGE));
    setOrderPage((prev) => Math.min(prev, nextPages));
  }

  function safeNumber(value: unknown) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  const groupedProducts = useMemo(() => {
    return products.reduce<Record<string, Product[]>>((acc, product) => {
      if (!acc[product.category]) acc[product.category] = [];
      acc[product.category].push(product);
      return acc;
    }, {});
  }, [products]);

  const categoryList = useMemo(() => Object.keys(groupedProducts), [groupedProducts]);

  useEffect(() => {
    if (!activeCategory && categoryList.length > 0) {
      setActiveCategory(categoryList[0]);
    }
  }, [activeCategory, categoryList]);

  const visibleProducts = useMemo(() => {
    return groupedProducts[activeCategory] ?? [];
  }, [groupedProducts, activeCategory]);

  const itemsSubtotal = useMemo(() => {
    return orderItems.reduce((sum, item) => {
      if (item.is_complimentary) return sum;
      return sum + safeNumber(item.line_total);
    }, 0);
  }, [orderItems]);

  const tipAmount = useMemo(() => safeNumber(tipAmountInput), [tipAmountInput]);

  const finalTotal = useMemo(() => {
    const discount = safeNumber(session?.discount_amount ?? 0);
    return Math.max(itemsSubtotal - discount, 0) + Math.max(tipAmount, 0);
  }, [itemsSubtotal, session?.discount_amount, tipAmount]);

  const amountReceived = useMemo(() => safeNumber(amountReceivedInput), [amountReceivedInput]);

  const changeAmount = useMemo(() => {
    return Math.max(amountReceived - finalTotal, 0);
  }, [amountReceived, finalTotal]);

  const remainingAmount = useMemo(() => {
    return Math.max(finalTotal - amountReceived, 0);
  }, [amountReceived, finalTotal]);

  const totalOrderPages = useMemo(() => {
    return Math.max(1, Math.ceil(orderItems.length / ORDER_ITEMS_PER_PAGE));
  }, [orderItems.length]);

  const pagedOrderItems = useMemo(() => {
    const start = (orderPage - 1) * ORDER_ITEMS_PER_PAGE;
    return orderItems.slice(start, start + ORDER_ITEMS_PER_PAGE);
  }, [orderItems, orderPage]);

  async function refreshTotals(nextTipAmount?: number) {
    const { data, error } = await supabase
      .from("order_items")
      .select("line_total, is_complimentary")
      .eq("session_id", sessionId)
      .eq("status", "active");

    if (error) throw error;

    const subtotal = (data ?? []).reduce((sum, item) => {
      if (item.is_complimentary) return sum;
      return sum + Number(item.line_total ?? 0);
    }, 0);

    const discount = Number(session?.discount_amount ?? 0);
    const tip = nextTipAmount ?? Number(session?.tip_amount ?? 0);
    const total = Math.max(subtotal - discount, 0) + Math.max(Number(tip ?? 0), 0);

    const { error: updateError } = await supabase
      .from("dining_sessions")
      .update({
        subtotal_amount: subtotal,
        total_amount: total,
        tip_amount: Math.max(Number(tip ?? 0), 0),
      })
      .eq("id", sessionId);

    if (updateError) throw updateError;
  }

  function toggleExtra(extra: string) {
    setSelectedExtras((prev) =>
      prev.includes(extra) ? prev.filter((item) => item !== extra) : [...prev, extra]
    );
  }

  function buildSpecNote() {
    const extrasText = selectedExtras.length > 0 ? ` / ${selectedExtras.join("、")}` : "";
    return `${selectedTemp} / ${selectedSugar}${extrasText}`;
  }

  async function addOrderItem(product: Product) {
    if (isLocked) return;

    try {
      setIsAdding(true);

      const specNote = buildSpecNote();

      const existingItem = orderItems.find(
        (item) =>
          item.product_id === product.id &&
          item.note === specNote &&
          item.status === "active" &&
          (item.custom_note ?? "") === "" &&
          !item.is_complimentary
      );

      if (existingItem) {
        const nextQty = existingItem.quantity + 1;
        const nextLineTotal = Number(existingItem.unit_price) * nextQty;

        const { error } = await supabase
          .from("order_items")
          .update({
            quantity: nextQty,
            line_total: nextLineTotal,
          })
          .eq("id", existingItem.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from("order_items").insert({
          session_id: sessionId,
          product_id: product.id,
          product_name: product.name,
          unit_price: product.price,
          quantity: 1,
          line_total: product.price,
          note: specNote,
          custom_note: "",
          status: "active",
          is_complimentary: false,
        });

        if (error) throw error;
      }

      await loadOrderItems();
      await refreshTotals();
      await loadSession();
    } catch (error) {
      console.error("加點失敗：", error);
      alert("加點失敗");
    } finally {
      setIsAdding(false);
    }
  }

  async function updateItemQuantity(item: OrderItem, nextQty: number) {
    if (isLocked) return;

    try {
      if (nextQty <= 0) {
        await removeOrderItem(item.id);
        return;
      }

      const nextLineTotal = Number(item.unit_price) * nextQty;

      const { error } = await supabase
        .from("order_items")
        .update({
          quantity: nextQty,
          line_total: nextLineTotal,
        })
        .eq("id", item.id);

      if (error) throw error;

      await loadOrderItems();
      await refreshTotals();
      await loadSession();
    } catch (error) {
      console.error("更新數量失敗：", error);
      alert("更新數量失敗");
    }
  }

  async function removeOrderItem(itemId: string) {
    if (isLocked) return;

    try {
      const { error } = await supabase
        .from("order_items")
        .update({ status: "cancelled" })
        .eq("id", itemId);

      if (error) throw error;

      await loadOrderItems();
      await refreshTotals();
      await loadSession();
    } catch (error) {
      console.error("刪除品項失敗：", error);
      alert("刪除品項失敗");
    }
  }

  async function toggleComplimentary(item: OrderItem) {
    if (isLocked) return;

    try {
      const nextValue = !item.is_complimentary;

      const { error } = await supabase
        .from("order_items")
        .update({
          is_complimentary: nextValue,
        })
        .eq("id", item.id);

      if (error) throw error;

      await loadOrderItems();
      await refreshTotals();
      await loadSession();
    } catch (error) {
      console.error("切換招待狀態失敗：", error);
      alert("更新招待狀態失敗");
    }
  }

  async function saveCustomNote(itemId: string) {
    if (isLocked) return;

    try {
      setSavingNoteId(itemId);

      const noteValue = noteDrafts[itemId] ?? "";

      const { error } = await supabase
        .from("order_items")
        .update({
          custom_note: noteValue,
        })
        .eq("id", itemId);

      if (error) throw error;

      await loadOrderItems();
    } catch (error) {
      console.error("儲存備註失敗：", error);
      alert("儲存備註失敗");
    } finally {
      setSavingNoteId(null);
    }
  }

  async function updateCustomerType(nextType: string) {
    if (!session) return;

    try {
      const { error } = await supabase
        .from("dining_sessions")
        .update({
          customer_type: nextType,
        })
        .eq("id", sessionId);

      if (error) throw error;

      setSession((prev) =>
        prev
          ? {
              ...prev,
              customer_type: nextType,
            }
          : prev
      );
    } catch (error) {
      console.error("更新客人類型失敗：", error);
      alert("更新客人類型失敗");
    }
  }

  async function saveCustomerLabel() {
    if (!session) return;

    try {
      setIsSavingCustomerLabel(true);

      const { error } = await supabase
        .from("dining_sessions")
        .update({
          customer_label: customerLabel.trim(),
        })
        .eq("id", sessionId);

      if (error) throw error;

      setSession((prev) =>
        prev
          ? {
              ...prev,
              customer_label: customerLabel.trim(),
            }
          : prev
      );
    } catch (error) {
      console.error("儲存客人名稱失敗：", error);
      alert("儲存客人名稱失敗");
    } finally {
      setIsSavingCustomerLabel(false);
    }
  }

  async function savePaymentMethod() {
    if (!session) return;

    try {
      setIsSavingPaymentMethod(true);

      const { error } = await supabase
        .from("dining_sessions")
        .update({
          payment_method: paymentMethod,
        })
        .eq("id", sessionId);

      if (error) throw error;

      setSession((prev) =>
        prev
          ? {
              ...prev,
              payment_method: paymentMethod,
            }
          : prev
      );
    } catch (error) {
      console.error("儲存付款方式失敗：", error);
      alert("儲存付款方式失敗");
    } finally {
      setIsSavingPaymentMethod(false);
    }
  }

  async function saveTipAmount() {
    if (!session || isLocked) return;

    try {
      setIsSavingTip(true);

      const nextTip = Math.max(safeNumber(tipAmountInput), 0);

      const { error } = await supabase
        .from("dining_sessions")
        .update({
          tip_amount: nextTip,
        })
        .eq("id", sessionId);

      if (error) throw error;

      await refreshTotals(nextTip);
      await loadSession();
    } catch (error) {
      console.error("儲存小費失敗：", error);
      alert("儲存小費失敗");
    } finally {
      setIsSavingTip(false);
    }
  }

  function openCheckoutModal() {
    if (!session) return;

    if (orderItems.length === 0) {
      alert("目前沒有任何商品，無法結帳");
      return;
    }

    if (amountReceived < finalTotal) {
      alert("實收金額不足，無法結帳");
      return;
    }

    setShowCheckoutModal(true);
  }

  async function confirmCheckout() {
    if (!session) return;

    if (orderItems.length === 0) {
      alert("目前沒有任何商品，無法結帳");
      return;
    }

    if (amountReceived < finalTotal) {
      alert("實收金額不足，無法結帳");
      return;
    }

    try {
      setIsPaying(true);

      const { error } = await supabase
        .from("dining_sessions")
        .update({
          order_status: "closed",
          payment_status: "paid",
          payment_method: paymentMethod,
          tip_amount: Math.max(tipAmount, 0),
          amount_received: amountReceived,
          change_amount: changeAmount,
          total_amount: finalTotal,
          paid_at: new Date().toISOString(),
        })
        .eq("id", sessionId);

      if (error) throw error;

      alert("結帳完成");
      router.push("/");
    } catch (error) {
      console.error("結帳失敗：", error);
      alert("結帳失敗");
    } finally {
      setIsPaying(false);
      setShowCheckoutModal(false);
    }
  }

  async function handleDeleteSession() {
    if (!session) return;

    const confirmed = window.confirm(
      "確定要刪除這張訂單嗎？\n刪除後會解除座位佔用，且這張單會消失。"
    );

    if (!confirmed) return;

    try {
      setIsDeletingSession(true);

      const { error: orderItemsError } = await supabase
        .from("order_items")
        .delete()
        .eq("session_id", sessionId);

      if (orderItemsError) throw orderItemsError;

      const { error: sessionSeatsError } = await supabase
        .from("session_seats")
        .delete()
        .eq("session_id", sessionId);

      if (sessionSeatsError) throw sessionSeatsError;

      const { error: sessionError } = await supabase
        .from("dining_sessions")
        .delete()
        .eq("id", sessionId);

      if (sessionError) throw sessionError;

      alert("訂單已刪除");
      router.push("/");
    } catch (error) {
      console.error("刪除訂單失敗：", error);
      alert("刪除訂單失敗");
    } finally {
      setIsDeletingSession(false);
    }
  }

  if (isLoading) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#f6f6f3]">
        載入中...
      </main>
    );
  }

  if (!session) {
    return (
      <main className="flex h-screen items-center justify-center bg-[#f6f6f3]">
        找不到此訂單
      </main>
    );
  }

  return (
    <>
      <main className="h-screen overflow-hidden bg-[#f6f6f3] p-2 text-gray-900">
        <div className="mx-auto flex h-full max-w-[1700px] flex-col gap-2">
          <header className="grid h-[80px] shrink-0 grid-cols-[1fr_auto] items-center rounded-[28px] bg-white px-4 shadow-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={() => router.push("/")}
                className="h-12 rounded-2xl bg-gray-100 px-4 text-sm font-semibold hover:bg-gray-200"
              >
                ← 返回座位
              </button>

              <div className="rounded-2xl bg-gray-50 px-4 py-2">
                <p className="text-xs text-gray-500">主單編號</p>
                <p className="text-base font-bold">{session.session_number}</p>
              </div>

              <div className="rounded-2xl bg-gray-50 px-4 py-2">
                <p className="text-xs text-gray-500">來客數</p>
                <p className="text-base font-bold">{session.guest_count} 人</p>
              </div>

              <div className="rounded-2xl bg-gray-50 px-4 py-2">
                <p className="text-xs text-gray-500">狀態</p>
                <p className="text-base font-bold">
                  {session.payment_status === "paid" ? "已結帳" : "處理中"}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={handleDeleteSession}
              disabled={isDeletingSession}
              className="h-12 rounded-2xl bg-red-100 px-4 text-sm font-semibold text-red-700 hover:bg-red-200 disabled:opacity-60"
            >
              {isDeletingSession ? "刪除中..." : "刪除訂單"}
            </button>
          </header>

          <div className="grid min-h-0 flex-1 grid-cols-[320px_minmax(0,1fr)_420px] gap-2">
            <section className="grid min-h-0 grid-rows-[auto_auto_auto_1fr_auto] gap-2 rounded-[28px] bg-white p-3 shadow-sm">
              <div className="rounded-3xl bg-gray-50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-lg font-bold">主單資訊</h2>
                  {isLocked && (
                    <span className="rounded-full bg-green-100 px-3 py-1 text-xs font-bold text-green-700">
                      已結帳
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-gray-500">訂單狀態</p>
                    <p className="mt-1 font-bold">{session.order_status}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-3">
                    <p className="text-gray-500">付款狀態</p>
                    <p className="mt-1 font-bold">{session.payment_status}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl border border-gray-200 p-3">
                <label className="mb-1 block text-sm font-medium text-gray-600">付款方式</label>
                <div className="grid grid-cols-3 gap-2">
                  {PAYMENT_METHOD_OPTIONS.map((method) => (
                    <button
                      key={method}
                      type="button"
                      disabled={isLocked}
                      onClick={() => setPaymentMethod(method)}
                      className={`h-11 rounded-2xl text-sm font-semibold ${
                        paymentMethod === method
                          ? "bg-sky-500 text-white"
                          : "bg-gray-100 text-gray-700"
                      } disabled:opacity-60`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={savePaymentMethod}
                  disabled={isLocked || isSavingPaymentMethod}
                  className="mt-2 h-11 w-full rounded-2xl bg-sky-100 text-sm font-semibold text-sky-800 hover:bg-sky-200 disabled:opacity-60"
                >
                  {isSavingPaymentMethod ? "儲存中..." : "儲存付款方式"}
                </button>
              </div>

              <div className="rounded-3xl border border-gray-200 p-3">
                <label className="mb-1 block text-sm font-medium text-gray-600">客人類型</label>
                <div className="grid grid-cols-2 gap-2">
                  {CUSTOMER_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => updateCustomerType(type)}
                      className={`h-10 rounded-2xl text-sm font-semibold ${
                        (session.customer_type ?? "客人") === type
                          ? "bg-amber-500 text-white"
                          : "bg-gray-100 text-gray-700"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                <label className="mt-3 block text-sm font-medium text-gray-600">客人備註</label>
                <input
                  type="text"
                  value={customerLabel}
                  onChange={(e) => setCustomerLabel(e.target.value)}
                  placeholder="例如：小安、熟客、阿華朋友"
                  className="mt-1 h-11 w-full rounded-2xl border border-gray-300 px-3 text-sm outline-none focus:border-amber-500"
                />
                <button
                  type="button"
                  onClick={saveCustomerLabel}
                  disabled={isSavingCustomerLabel}
                  className="mt-2 h-11 w-full rounded-2xl bg-amber-100 text-sm font-semibold text-amber-800 hover:bg-amber-200 disabled:opacity-60"
                >
                  {isSavingCustomerLabel ? "儲存中..." : "儲存名稱備註"}
                </button>
              </div>

              <div className="rounded-3xl border border-gray-200 p-3">
                <h2 className="mb-2 text-lg font-bold">快速規格</h2>

                <div className="space-y-3">
                  <div>
                    <p className="mb-1 text-sm font-medium text-gray-500">溫度</p>
                    <div className="grid grid-cols-3 gap-2">
                      {TEMP_OPTIONS.map((temp) => (
                        <button
                          key={temp}
                          type="button"
                          onClick={() => setSelectedTemp(temp)}
                          className={`h-11 rounded-2xl text-sm font-semibold ${
                            selectedTemp === temp
                              ? "bg-blue-500 text-white"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {temp}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm font-medium text-gray-500">甜度</p>
                    <div className="grid grid-cols-2 gap-2">
                      {SUGAR_OPTIONS.map((sugar) => (
                        <button
                          key={sugar}
                          type="button"
                          onClick={() => setSelectedSugar(sugar)}
                          className={`h-11 rounded-2xl text-sm font-semibold ${
                            selectedSugar === sugar
                              ? "bg-pink-500 text-white"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {sugar}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-1 text-sm font-medium text-gray-500">加註</p>
                    <div className="grid grid-cols-2 gap-2">
                      {EXTRA_OPTIONS.map((extra) => (
                        <button
                          key={extra}
                          type="button"
                          onClick={() => toggleExtra(extra)}
                          className={`h-11 rounded-2xl text-sm font-semibold ${
                            selectedExtras.includes(extra)
                              ? "bg-violet-500 text-white"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {extra}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-3xl bg-gray-50 p-3">
                <p className="text-xs text-gray-500">目前規格</p>
                <p className="mt-1 line-clamp-2 text-sm font-bold">{buildSpecNote()}</p>
              </div>
            </section>

            <section className="grid min-h-0 grid-rows-[auto_auto_1fr] gap-2 rounded-[28px] bg-white p-3 shadow-sm">
              <div className="flex items-center justify-between rounded-3xl bg-gray-50 px-4 py-3">
                <div>
                  <h2 className="text-xl font-bold">商品點餐</h2>
                  <p className="text-sm text-gray-500">分類切換，不使用捲動</p>
                </div>
                <div className="rounded-2xl bg-white px-4 py-2 text-sm font-medium text-gray-600">
                  {isAdding ? "加點中..." : "點一下直接加入"}
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2">
                {categoryList.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setActiveCategory(category)}
                    className={`h-12 rounded-2xl px-3 text-sm font-semibold ${
                      activeCategory === category
                        ? "bg-amber-500 text-white"
                        : "bg-gray-100 text-gray-700"
                    }`}
                  >
                    {category}
                  </button>
                ))}
              </div>

              <div className="grid min-h-0 grid-cols-3 gap-2">
                {visibleProducts.slice(0, 12).map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addOrderItem(product)}
                    disabled={isAdding || isLocked}
                    className="flex h-full min-h-[112px] flex-col justify-between rounded-[24px] border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:bg-amber-50 disabled:opacity-60"
                  >
                    <div>
                      <p className="line-clamp-2 text-lg font-bold leading-tight">
                        {product.name}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">{product.category}</p>
                    </div>
                    <p className="mt-3 text-2xl font-bold text-amber-600">${Number(product.price)}</p>
                  </button>
                ))}

                {visibleProducts.length === 0 && (
                  <div className="col-span-3 flex items-center justify-center rounded-[24px] bg-gray-50 text-gray-500">
                    此分類目前沒有商品
                  </div>
                )}
              </div>
            </section>

            <section className="grid min-h-0 grid-rows-[auto_1fr_auto] rounded-[28px] bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-2xl font-bold">訂單</h2>
                    <p className="mt-1 text-sm text-gray-500">固定畫面，品項改分頁</p>
                  </div>

                  <div className="rounded-2xl bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-600">
                    第 {orderPage} / {totalOrderPages} 頁
                  </div>
                </div>
              </div>

              <div className="grid min-h-0 grid-rows-[1fr_auto] gap-2 px-4 py-3">
                <div className="grid auto-rows-fr gap-2">
                  {pagedOrderItems.length === 0 ? (
                    <div className="flex items-center justify-center rounded-3xl bg-gray-100 text-base text-gray-500">
                      尚未加點
                    </div>
                  ) : (
                    pagedOrderItems.map((item) => {
                      const isComplimentary = Boolean(item.is_complimentary);
                      const displayLineTotal = isComplimentary ? 0 : Number(item.line_total);

                      return (
                        <div
                          key={item.id}
                          className={`grid min-h-0 grid-cols-[1fr_auto] gap-3 rounded-3xl border p-3 ${
                            isComplimentary
                              ? "border-amber-300 bg-amber-50"
                              : "border-gray-200 bg-white"
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-base font-bold">{item.product_name}</p>
                              {isComplimentary && (
                                <span className="rounded-full bg-amber-200 px-2 py-0.5 text-[10px] font-bold text-amber-900">
                                  招待
                                </span>
                              )}
                            </div>

                            <p className="mt-1 truncate text-xs text-gray-500">{item.note}</p>
                            <p className="mt-1 text-xs text-gray-500">
                              ${Number(item.unit_price)} × {item.quantity}
                            </p>

                            <div className="mt-2 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => updateItemQuantity(item, item.quantity - 1)}
                                disabled={isLocked}
                                className="h-9 min-w-[42px] rounded-2xl bg-gray-200 text-sm font-bold disabled:opacity-60"
                              >
                                -1
                              </button>

                              <div className="flex h-9 min-w-[42px] items-center justify-center rounded-2xl bg-gray-50 px-3 text-sm font-bold ring-1 ring-gray-200">
                                {item.quantity}
                              </div>

                              <button
                                type="button"
                                onClick={() => updateItemQuantity(item, item.quantity + 1)}
                                disabled={isLocked}
                                className="h-9 min-w-[42px] rounded-2xl bg-blue-500 text-sm font-bold text-white disabled:opacity-60"
                              >
                                +1
                              </button>

                              <button
                                type="button"
                                onClick={() => toggleComplimentary(item)}
                                disabled={isLocked}
                                className={`h-9 rounded-2xl px-3 text-xs font-semibold disabled:opacity-60 ${
                                  isComplimentary
                                    ? "bg-amber-500 text-white"
                                    : "bg-amber-100 text-amber-900"
                                }`}
                              >
                                {isComplimentary ? "取消招待" : "設為招待"}
                              </button>

                              <button
                                type="button"
                                onClick={() => removeOrderItem(item.id)}
                                disabled={isLocked}
                                className="ml-auto h-9 rounded-2xl bg-red-500 px-3 text-xs font-semibold text-white disabled:opacity-60"
                              >
                                刪除
                              </button>
                            </div>
                          </div>

                          <div className="flex w-[116px] flex-col justify-between">
                            <div className="text-right">
                              <p className="text-lg font-bold">${displayLineTotal}</p>
                            </div>

                            <div>
                              <textarea
                                value={noteDrafts[item.id] ?? ""}
                                onChange={(e) =>
                                  setNoteDrafts((prev) => ({
                                    ...prev,
                                    [item.id]: e.target.value,
                                  }))
                                }
                                disabled={isLocked}
                                rows={2}
                                placeholder="備註"
                                className="w-full resize-none rounded-2xl border border-gray-300 px-2 py-2 text-xs outline-none focus:border-amber-500 disabled:bg-gray-100"
                              />
                              <button
                                type="button"
                                onClick={() => saveCustomNote(item.id)}
                                disabled={isLocked || savingNoteId === item.id}
                                className="mt-1 h-8 w-full rounded-xl bg-amber-100 text-xs font-semibold text-amber-800 disabled:opacity-60"
                              >
                                {savingNoteId === item.id ? "儲存中" : "存備註"}
                              </button>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>

                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <button
                    type="button"
                    onClick={() => setOrderPage((prev) => Math.max(1, prev - 1))}
                    disabled={orderPage === 1}
                    className="h-11 rounded-2xl bg-gray-100 text-sm font-semibold text-gray-700 disabled:opacity-50"
                  >
                    上一頁
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderPage((prev) => Math.min(totalOrderPages, prev + 1))}
                    disabled={orderPage === totalOrderPages}
                    className="h-11 rounded-2xl bg-gray-100 text-sm font-semibold text-gray-700 disabled:opacity-50"
                  >
                    下一頁
                  </button>
                </div>
              </div>

              <div className="border-t border-gray-200 bg-white px-4 py-3">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">餐點小計</span>
                    <span className="font-semibold">${itemsSubtotal}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">折扣</span>
                    <span className="font-semibold">${Number(session.discount_amount ?? 0)}</span>
                  </div>

                  <div className="col-span-2 grid grid-cols-[1fr_auto] gap-2">
                    <input
                      type="number"
                      min={0}
                      value={tipAmountInput}
                      onChange={(e) => setTipAmountInput(e.target.value)}
                      disabled={isLocked}
                      className="h-11 rounded-2xl border border-gray-300 px-3 text-sm outline-none focus:border-amber-500 disabled:bg-gray-100"
                      placeholder="輸入小費"
                    />
                    <button
                      type="button"
                      onClick={saveTipAmount}
                      disabled={isLocked || isSavingTip}
                      className="h-11 rounded-2xl bg-purple-100 px-4 text-sm font-semibold text-purple-800 disabled:opacity-60"
                    >
                      {isSavingTip ? "儲存中" : "儲存小費"}
                    </button>
                  </div>

                  <div className="col-span-2 grid grid-cols-[1fr_auto] gap-2">
                    <input
                      type="number"
                      min={0}
                      value={amountReceivedInput}
                      onChange={(e) => setAmountReceivedInput(e.target.value)}
                      disabled={isLocked}
                      className="h-11 rounded-2xl border border-gray-300 px-3 text-sm outline-none focus:border-amber-500 disabled:bg-gray-100"
                      placeholder="請輸入實收金額"
                    />
                    <div className="flex items-center rounded-2xl bg-gray-100 px-4 text-sm font-semibold">
                      找零 ${changeAmount}
                    </div>
                  </div>

                  <div className="flex justify-between text-base font-bold">
                    <span>總計</span>
                    <span>${finalTotal}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">尚差</span>
                    <span className={`font-semibold ${remainingAmount > 0 ? "text-red-600" : ""}`}>
                      ${remainingAmount}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={openCheckoutModal}
                  disabled={isPaying || isLocked}
                  className="mt-3 h-14 w-full rounded-3xl bg-emerald-500 text-lg font-bold text-white hover:bg-emerald-600 disabled:opacity-60"
                >
                  {isLocked ? "已結帳" : isPaying ? "結帳中..." : "結帳確認"}
                </button>
              </div>
            </section>
          </div>
        </div>
      </main>

      {showCheckoutModal && !isLocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-2xl font-bold text-gray-900">確認結帳</h3>
            <p className="mt-2 text-sm text-gray-500">
              請再次確認本次結帳資訊，送出後此訂單會標記為已付款。
            </p>

            <div className="mt-6 space-y-3 rounded-2xl bg-gray-50 p-4">
              <div className="flex justify-between text-gray-700">
                <span>餐點小計</span>
                <span>${itemsSubtotal}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>折扣</span>
                <span>${Number(session.discount_amount ?? 0)}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>小費</span>
                <span>${tipAmount}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>付款方式</span>
                <span>{paymentMethod}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>實收</span>
                <span>${amountReceived}</span>
              </div>
              <div className="flex justify-between text-gray-700">
                <span>找零</span>
                <span>${changeAmount}</span>
              </div>
              <div className="flex justify-between border-t pt-3 text-xl font-bold text-gray-900">
                <span>總計</span>
                <span>${finalTotal}</span>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setShowCheckoutModal(false)}
                className="min-h-[54px] rounded-2xl bg-gray-100 px-4 text-base font-semibold text-gray-800 hover:bg-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={confirmCheckout}
                disabled={isPaying}
                className="min-h-[54px] rounded-2xl bg-emerald-500 px-4 text-base font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
              >
                {isPaying ? "結帳中..." : "確認結帳"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}