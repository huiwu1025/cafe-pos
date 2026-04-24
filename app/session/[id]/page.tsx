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

type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  is_active: boolean;
  sort_order: number;
};

type ProductPriceHistoryRow = {
  product_id: string;
  price: number;
  effective_from: string;
};

type OrderItem = {
  id: string;
  session_id: string;
  product_id: string | null;
  product_name: string;
  unit_price: number;
  quantity: number;
  line_total: number;
  note: string | null;
  custom_note: string | null;
  status: string;
  is_complimentary?: boolean | null;
  is_served?: boolean | null;
  created_at?: string | null;
};

type SeatRow = {
  id: string;
  seat_code: string;
};

type SessionSeatRow = {
  session_id: string;
  seats: { seat_code: string } | { seat_code: string }[] | null;
  dining_sessions?: {
    id: string;
    order_status: string;
    payment_status: string;
  } | {
    id: string;
    order_status: string;
    payment_status: string;
  }[] | null;
};

type ReservationSeatRow = {
  reservation_id: string;
  seats: { seat_code: string } | { seat_code: string }[] | null;
  reservations?: {
    id: string;
    reservation_date: string;
    status: string;
  } | {
    id: string;
    reservation_date: string;
    status: string;
  }[] | null;
};

const CUSTOMER_TYPES = ["客人", "朋友", "熟客", "員工", "粉絲"];
const TEMP_OPTIONS = ["冰", "涼", "熱"];
const SUGAR_OPTIONS = ["兩倍糖", "正常", "少糖", "無糖"];
const PAYMENT_METHOD_OPTIONS = ["現金", "歐付寶", "其他"];
const EMPLOYEE_DISCOUNT_RATE = 0.2;
const MIN_CHECKOUT_RULE_START = "2026-04-17";
const MIN_CHECKOUT_AMOUNT = 100;
const STAY_NOTICE_MINUTES = 120;

function todayIsoDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
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

function appendTransferNote(existingLabel: string | null | undefined, fromSeats: string[], toSeats: string[]) {
  const base = (existingLabel ?? "").trim();
  const timestamp = new Date().toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const transferNote = `轉桌 ${formatSeatLabel(fromSeats)} → ${formatSeatLabel(toSeats)} ${timestamp}`;
  if (!base) return transferNote;
  return `${base} / ${transferNote}`;
}

function formatDateToTaipeiIso(value: string | Date | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

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

  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});
  const [savingNoteId, setSavingNoteId] = useState<string | null>(null);

  const [customerMemo, setCustomerMemo] = useState("");
  const [isSavingCustomerLabel, setIsSavingCustomerLabel] = useState(false);
  const [isSavingGuestCount, setIsSavingGuestCount] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState("現金");
  const [isSavingPaymentMethod, setIsSavingPaymentMethod] = useState(false);

  const [tipAmountInput, setTipAmountInput] = useState("0");
  const [isSavingTip, setIsSavingTip] = useState(false);

  const [amountReceivedInput, setAmountReceivedInput] = useState("");
  const [showCheckoutModal, setShowCheckoutModal] = useState(false);
  const [showManualSurchargeModal, setShowManualSurchargeModal] = useState(false);
  const [showTransferSeatModal, setShowTransferSeatModal] = useState(false);
  const [manualSurchargeAmount, setManualSurchargeAmount] = useState("");
  const [manualSurchargeReason, setManualSurchargeReason] = useState("");
  const [allSeats, setAllSeats] = useState<SeatRow[]>([]);
  const [currentSeatCodes, setCurrentSeatCodes] = useState<string[]>([]);
  const [occupiedSeatCodes, setOccupiedSeatCodes] = useState<string[]>([]);
  const [reservedSeatCodes, setReservedSeatCodes] = useState<string[]>([]);
  const [transferSeatCodes, setTransferSeatCodes] = useState<string[]>([]);
  const [isTransferringSeat, setIsTransferringSeat] = useState(false);

  const [activeCategory, setActiveCategory] = useState<string>("全部");

  const isLocked = session?.payment_status === "paid";

  useEffect(() => {
    const nextDrafts: Record<string, string> = {};
    for (const item of orderItems) {
      nextDrafts[item.id] = item.custom_note ?? "";
    }
    setNoteDrafts(nextDrafts);
  }, [orderItems]);

  const loadSession = useCallback(async () => {
    const { data, error } = await supabase
      .from("dining_sessions")
      .select("*")
      .eq("id", sessionId)
      .single();

    if (error) throw error;

    setSession(data);
    setCustomerMemo(data.customer_label ?? "");
    setPaymentMethod(data.payment_method ?? "現金");
    setTipAmountInput(String(Number(data.tip_amount ?? 0)));
    setAmountReceivedInput(
      data.amount_received !== null && data.amount_received !== undefined
        ? String(Number(data.amount_received))
        : ""
    );
  }, [sessionId]);

  const loadProducts = useCallback(async () => {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;

    const baseProducts = (data ?? []) as Product[];
    if (baseProducts.length === 0) {
      setProducts([]);
      return;
    }

    const productIds = baseProducts.map((product) => product.id);
    const businessDate = todayIsoDate();
    const { data: priceHistoryData, error: priceHistoryError } = await supabase
      .from("product_price_history")
      .select("product_id, price, effective_from")
      .in("product_id", productIds)
      .lte("effective_from", businessDate)
      .order("effective_from", { ascending: false });

    if (priceHistoryError && !priceHistoryError.message?.includes("product_price_history")) {
      throw priceHistoryError;
    }

    const effectivePriceMap = new Map<string, number>();
    for (const row of ((priceHistoryData ?? []) as ProductPriceHistoryRow[])) {
      if (!effectivePriceMap.has(row.product_id)) {
        effectivePriceMap.set(row.product_id, Number(row.price ?? 0));
      }
    }

    setProducts(
      baseProducts.map((product) => ({
        ...product,
        price: effectivePriceMap.get(product.id) ?? Number(product.price ?? 0),
      }))
    );
  }, []);

  const loadOrderItems = useCallback(async () => {
    const { data, error } = await supabase
      .from("order_items")
      .select("*")
      .eq("session_id", sessionId)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) throw error;
    setOrderItems(data ?? []);
  }, [sessionId]);

  const loadSeatContext = useCallback(async () => {
    const [{ data: seatsData, error: seatsError }, { data: sessionSeatData, error: sessionSeatError }, { data: reservationSeatData, error: reservationSeatError }] =
      await Promise.all([
        supabase.from("seats").select("id, seat_code").order("seat_code", { ascending: true }),
        supabase.from("session_seats").select(`
          session_id,
          seats:seat_id (
            seat_code
          ),
          dining_sessions:session_id (
            id,
            order_status,
            payment_status
          )
        `),
        supabase.from("reservation_seats").select(`
          reservation_id,
          seats:seat_id (
            seat_code
          ),
          reservations:reservation_id (
            id,
            reservation_date,
            status
          )
        `),
      ]);

    if (seatsError) throw seatsError;
    if (sessionSeatError) throw sessionSeatError;

    const today = todayIsoDate();
    const occupied = new Set<string>();
    const mine = new Set<string>();

    for (const row of (sessionSeatData ?? []) as SessionSeatRow[]) {
      const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
      const linkedSession = Array.isArray(row.dining_sessions) ? row.dining_sessions[0] : row.dining_sessions;
      if (!seat?.seat_code) continue;

      if (row.session_id === sessionId) {
        mine.add(seat.seat_code);
        continue;
      }

      if (
        linkedSession?.id &&
        linkedSession.order_status === "open" &&
        linkedSession.payment_status === "unpaid"
      ) {
        occupied.add(seat.seat_code);
      }
    }

    const reserved = new Set<string>();
    if (!reservationSeatError) {
      for (const row of (reservationSeatData ?? []) as ReservationSeatRow[]) {
        const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
        const reservation = Array.isArray(row.reservations) ? row.reservations[0] : row.reservations;
        if (!seat?.seat_code || !reservation?.id) continue;
        if (reservation.status === "reserved" && reservation.reservation_date === today) {
          reserved.add(seat.seat_code);
        }
      }
    }

    setAllSeats((seatsData ?? []) as SeatRow[]);
    setCurrentSeatCodes([...mine].sort(sortSeatCodes));
    setOccupiedSeatCodes([...occupied].sort(sortSeatCodes));
    setReservedSeatCodes([...reserved].sort(sortSeatCodes));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId) return;

    async function runInit() {
      try {
        setIsLoading(true);
        await Promise.all([loadSession(), loadProducts(), loadOrderItems(), loadSeatContext()]);
      } catch (error) {
        console.error("初始化訂單頁失敗：", error);
        alert("載入訂單頁失敗，請查看 console");
      } finally {
        setIsLoading(false);
      }
    }

    runInit();
  }, [sessionId, loadOrderItems, loadProducts, loadSession, loadSeatContext]);

  function safeNumber(value: unknown) {
    const num = Number(value);
    return Number.isFinite(num) ? num : 0;
  }

  function calculateOrderDiscount(subtotal: number, customerType?: string | null) {
    if (customerType !== "員工") return 0;
    return Math.round(Math.max(subtotal, 0) * EMPLOYEE_DISCOUNT_RATE);
  }

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
  const isCurrentBarSession = useMemo(
    () => currentSeatCodes.length > 0 && currentSeatCodes.every((seat) => seat.startsWith("A")),
    [currentSeatCodes]
  );
  const transferSeatLimit = useMemo(() => {
    if (currentSeatCodes.length === 0) return 1;
    return isCurrentBarSession ? currentSeatCodes.length : 1;
  }, [currentSeatCodes, isCurrentBarSession]);
  const availableTransferSeats = useMemo(() => {
    return allSeats
      .filter(
        (seat) =>
          !currentSeatCodes.includes(seat.seat_code) &&
          !occupiedSeatCodes.includes(seat.seat_code) &&
          !reservedSeatCodes.includes(seat.seat_code)
      )
      .sort((a, b) => sortSeatCodes(a.seat_code, b.seat_code));
  }, [allSeats, currentSeatCodes, occupiedSeatCodes, reservedSeatCodes]);

  const changeAmount = useMemo(() => {
    return Math.max(amountReceived - finalTotal, 0);
  }, [amountReceived, finalTotal]);

  const sessionBusinessDate = useMemo(() => {
    return formatDateToTaipeiIso(session?.created_at ?? null) || todayIsoDate();
  }, [session?.created_at]);

  const isMinimumSpendRuleActive = useMemo(() => {
    return sessionBusinessDate >= MIN_CHECKOUT_RULE_START;
  }, [sessionBusinessDate]);

  const minimumSpendShortfall = useMemo(() => {
    if (!isMinimumSpendRuleActive) return 0;
    if (orderItems.length > 0 && orderItems.every((item) => Boolean(item.is_complimentary))) return 0;
    return Math.max(MIN_CHECKOUT_AMOUNT - finalTotal, 0);
  }, [finalTotal, isMinimumSpendRuleActive, orderItems]);

  const isAllComplimentaryOrder = useMemo(() => {
    return orderItems.length > 0 && orderItems.every((item) => Boolean(item.is_complimentary));
  }, [orderItems]);

  const sessionAgeMinutes = useMemo(() => {
    if (!session?.created_at) return 0;
    const createdAt = new Date(session.created_at);
    if (Number.isNaN(createdAt.getTime())) return 0;
    const endAt =
      session.payment_status === "paid" && session.paid_at ? new Date(session.paid_at) : new Date();
    if (Number.isNaN(endAt.getTime())) return 0;
    return Math.max(0, Math.round((endAt.getTime() - createdAt.getTime()) / 60000));
  }, [session?.created_at, session?.paid_at, session?.payment_status]);

  const shouldShowStayNotice = useMemo(() => {
    return session?.payment_status !== "paid" && sessionAgeMinutes >= STAY_NOTICE_MINUTES;
  }, [session?.payment_status, sessionAgeMinutes]);

  const remainingAmount = useMemo(() => {
    return Math.max(finalTotal - amountReceived, 0);
  }, [amountReceived, finalTotal]);

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

    const discount = calculateOrderDiscount(subtotal, session?.customer_type);
    const tip = nextTipAmount ?? Number(session?.tip_amount ?? 0);
    const total = Math.max(subtotal - discount, 0) + Math.max(Number(tip ?? 0), 0);

    const { error: updateError } = await supabase
      .from("dining_sessions")
      .update({
        subtotal_amount: subtotal,
        discount_amount: discount,
        total_amount: total,
        tip_amount: Math.max(Number(tip ?? 0), 0),
      })
      .eq("id", sessionId);

    if (updateError) throw updateError;
  }

  async function ensureManualSurchargeProduct() {
    const existingProduct = products.find((product) => product.name === "補價差");
    if (existingProduct) return existingProduct;

    const nextSortOrder =
      products.length > 0
        ? Math.max(...products.map((product) => Number(product.sort_order ?? 0))) + 1
        : 1;

    const { data, error } = await supabase
      .from("products")
      .insert({
        name: "補價差",
        category: "其他",
        price: 0,
        is_active: true,
        sort_order: nextSortOrder,
      })
      .select()
      .single();

    if (error) throw error;

    const nextProduct = data as Product;
    setProducts((prev) => [...prev, nextProduct]);
    return nextProduct;
  }

  function buildSpecNote() {
    return `${selectedTemp} / ${selectedSugar}`;
  }

  async function addManualSurcharge() {
    if (isLocked) return;

    const amount = Number(manualSurchargeAmount.trim());
    if (!Number.isFinite(amount) || amount <= 0) {
      alert("請輸入大於 0 的金額");
      return;
    }

    try {
      setIsAdding(true);
      const surchargeProduct = await ensureManualSurchargeProduct();

        const { error } = await supabase.from("order_items").insert({
          session_id: sessionId,
          product_id: surchargeProduct.id,
          product_name: "補價差",
        unit_price: amount,
        quantity: 1,
        line_total: amount,
        note: "手動補價差",
          custom_note: manualSurchargeReason.trim(),
          status: "active",
          is_complimentary: false,
          is_served: false,
        });

      if (error) throw error;

      await loadOrderItems();
      await refreshTotals();
      await loadSession();
      setManualSurchargeAmount("");
      setManualSurchargeReason("");
      setShowManualSurchargeModal(false);
    } catch (error) {
      console.error("Failed to add manual surcharge", error);
      alert("新增補價差失敗");
    } finally {
      setIsAdding(false);
    }
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
          !item.is_complimentary &&
          !item.is_served
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
          is_served: false,
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
      const nextDiscount = calculateOrderDiscount(itemsSubtotal, nextType);
      const nextTip = Number(session.tip_amount ?? 0);
      const nextTotal = Math.max(itemsSubtotal - nextDiscount, 0) + Math.max(nextTip, 0);

      const { error } = await supabase
        .from("dining_sessions")
        .update({
          customer_type: nextType,
          discount_amount: nextDiscount,
          total_amount: nextTotal,
        })
        .eq("id", sessionId);

      if (error) throw error;

      setSession((prev) =>
        prev
          ? {
              ...prev,
              customer_type: nextType,
              discount_amount: nextDiscount,
              total_amount: nextTotal,
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
          customer_label: customerMemo.trim(),
        })
        .eq("id", sessionId);

      if (error) throw error;

      setSession((prev) =>
        prev
            ? {
                ...prev,
                customer_label: customerMemo.trim(),
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

    if (minimumSpendShortfall > 0) {
      alert(`本單未達低消 ${MIN_CHECKOUT_AMOUNT} 元，還差 ${minimumSpendShortfall} 元`);
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

    if (minimumSpendShortfall > 0) {
      alert(`本單未達低消 ${MIN_CHECKOUT_AMOUNT} 元，還差 ${minimumSpendShortfall} 元`);
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

  async function toggleServed(item: OrderItem) {
    if (isLocked) return;

    try {
      const nextValue = !item.is_served;

      const { error } = await supabase
        .from("order_items")
        .update({
          is_served: nextValue,
        })
        .eq("id", item.id);

      if (error) throw error;

      await loadOrderItems();
    } catch (error) {
      console.error("切換出餐狀態失敗：", error);
      alert("更新出餐狀態失敗");
    }
  }

  async function updateGuestCount(nextGuestCount: number) {
    if (!session || isLocked) return;

    const normalized = Math.max(1, nextGuestCount);

    try {
      setIsSavingGuestCount(true);

      const { error } = await supabase
        .from("dining_sessions")
        .update({
          guest_count: normalized,
        })
        .eq("id", sessionId);

      if (error) throw error;

      setSession((prev) =>
        prev
          ? {
              ...prev,
              guest_count: normalized,
            }
          : prev
      );
    } catch (error) {
      console.error("更新來客數失敗：", error);
      alert("更新來客數失敗");
    } finally {
      setIsSavingGuestCount(false);
    }
  }

  function toggleTransferSeat(seatCode: string) {
    if (currentSeatCodes.length <= 1 || !isCurrentBarSession) {
      setTransferSeatCodes([seatCode]);
      return;
    }

    setTransferSeatCodes((prev) => {
      if (prev.includes(seatCode)) {
        return prev.filter((item) => item !== seatCode);
      }
      if (prev.length >= transferSeatLimit) return prev;
      return [...prev, seatCode].sort(sortSeatCodes);
    });
  }

  async function handleTransferSeat() {
    if (isLocked) return;
    if (transferSeatCodes.length === 0) {
      alert("請先選擇要轉去的座位");
      return;
    }
    if (currentSeatCodes.length > 1 && isCurrentBarSession && transferSeatCodes.length !== transferSeatLimit) {
      alert(`請選擇 ${transferSeatLimit} 個新座位`);
      return;
    }

    try {
      setIsTransferringSeat(true);

      const { data: seatRows, error: seatError } = await supabase
        .from("seats")
        .select("id, seat_code")
        .in("seat_code", transferSeatCodes);

      if (seatError) throw seatError;
      if ((seatRows ?? []).length !== transferSeatCodes.length) {
        alert("有座位不存在，請重新整理後再試");
        return;
      }

      const { data: latestSessionSeats, error: latestSessionSeatError } = await supabase
        .from("session_seats")
        .select(`
          session_id,
          seats:seat_id (
            seat_code
          ),
          dining_sessions:session_id (
            id,
            order_status,
            payment_status
          )
        `);

      if (latestSessionSeatError) throw latestSessionSeatError;

      const blockedSeats = new Set<string>();
      for (const row of (latestSessionSeats ?? []) as SessionSeatRow[]) {
        const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
        const linkedSession = Array.isArray(row.dining_sessions) ? row.dining_sessions[0] : row.dining_sessions;
        if (!seat?.seat_code || row.session_id === sessionId) continue;
        if (
          linkedSession?.id &&
          linkedSession.order_status === "open" &&
          linkedSession.payment_status === "unpaid"
        ) {
          blockedSeats.add(seat.seat_code);
        }
      }

      const { data: latestReservationSeats, error: latestReservationError } = await supabase
        .from("reservation_seats")
        .select(`
          reservation_id,
          seats:seat_id (
            seat_code
          ),
          reservations:reservation_id (
            id,
            reservation_date,
            status
          )
        `);

      if (!latestReservationError) {
        for (const row of (latestReservationSeats ?? []) as ReservationSeatRow[]) {
          const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;
          const reservation = Array.isArray(row.reservations) ? row.reservations[0] : row.reservations;
          if (!seat?.seat_code || !reservation?.id) continue;
          if (reservation.status === "reserved" && reservation.reservation_date === todayIsoDate()) {
            blockedSeats.add(seat.seat_code);
          }
        }
      }

      if (transferSeatCodes.some((seatCode) => blockedSeats.has(seatCode))) {
        alert("目標座位已被使用或保留，請重新選擇");
        await loadSeatContext();
        return;
      }

      const { error: deleteError } = await supabase.from("session_seats").delete().eq("session_id", sessionId);
      if (deleteError) throw deleteError;

      const { error: insertError } = await supabase.from("session_seats").insert(
        (seatRows ?? []).map((seat) => ({
          session_id: sessionId,
          seat_id: seat.id,
        }))
      );
      if (insertError) throw insertError;

      const nextCustomerLabel = appendTransferNote(session?.customer_label, currentSeatCodes, transferSeatCodes);
      const { error: updateSessionError } = await supabase
        .from("dining_sessions")
        .update({
          customer_label: nextCustomerLabel,
        })
        .eq("id", sessionId);
      if (updateSessionError) throw updateSessionError;

      setCustomerMemo(nextCustomerLabel);
      setTransferSeatCodes([]);
      setShowTransferSeatModal(false);
      await Promise.all([loadSeatContext(), loadSession()]);
      alert(`已轉桌到 ${formatSeatLabel(transferSeatCodes)}`);
    } catch (error) {
      console.error("轉桌失敗：", error);
      alert("轉桌失敗");
    } finally {
      setIsTransferringSeat(false);
    }
  }

  const groupedProducts = useMemo(() => {
    return products.reduce<Record<string, Product[]>>((acc, product) => {
      if (product.name === "補價差") return acc;
      const key = product.category || "未分類";
      if (!acc[key]) acc[key] = [];
      acc[key].push(product);
      return acc;
    }, {});
  }, [products]);

  const categoryTabs = useMemo(() => {
    return ["全部", ...Object.keys(groupedProducts)];
  }, [groupedProducts]);

  const displayedProducts = useMemo(() => {
    if (activeCategory === "全部") {
      return products.filter((product) => product.name !== "補價差");
    }
    return groupedProducts[activeCategory] ?? [];
  }, [activeCategory, groupedProducts, products]);

  if (isLoading) {
    return <main className="pos-shell p-8 text-slate-600">載入中...</main>;
  }

  if (!session) {
    return <main className="pos-shell p-8 text-slate-600">找不到此訂單</main>;
  }

  return (
    <>
      <main className="pos-shell bg-[#f6f6f3] p-3 md:p-4">
        <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-3">
          <div className="pos-panel flex flex-col gap-3 rounded-[28px] px-4 py-3 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => router.push("/")}
                className="h-11 rounded-2xl bg-gray-100 px-4 text-sm font-medium text-gray-800 hover:bg-gray-200 md:text-base"
              >
                ← 返回座位
              </button>

              <div className="rounded-2xl bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
                主單編號：
                <span className="ml-1 font-semibold text-gray-900">{session.session_number}</span>
              </div>

              <div className="rounded-2xl bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
                來客數：
                <span className="ml-1 font-semibold text-gray-900">{session.guest_count} 人</span>
              </div>

              <div className="rounded-2xl bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
                目前座位：
                <span className="ml-1 font-semibold text-gray-900">{formatSeatLabel(currentSeatCodes)}</span>
              </div>

              <div className="rounded-2xl bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
                狀態：
                <span className="ml-1 font-semibold text-gray-900">
                  {session.payment_status === "paid" ? "已結帳" : "處理中"}
                </span>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {!isLocked && (
                <button
                  type="button"
                  onClick={() => {
                    setTransferSeatCodes([]);
                    setShowTransferSeatModal(true);
                  }}
                  className="h-11 rounded-2xl bg-sky-100 px-5 text-base font-semibold text-sky-700 hover:bg-sky-200"
                >
                  轉桌
                </button>
              )}

              <button
                type="button"
                onClick={handleDeleteSession}
                disabled={isDeletingSession}
                className="h-11 rounded-2xl bg-red-100 px-5 text-base font-semibold text-red-700 hover:bg-red-200 disabled:opacity-60"
              >
                {isDeletingSession ? "刪除中..." : "刪除訂單"}
              </button>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[0.72fr_0.95fr_1.03fr]">
            <section className="flex min-h-0 flex-col gap-3">
              <div className="pos-panel flex min-h-0 flex-col rounded-[28px] p-4">
                <div className="mb-3">
                  <h2 className="text-2xl font-bold text-gray-900">主單資訊</h2>
                </div>

                <div className="pos-scroll space-y-4 md:min-h-0 md:pr-1">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-gray-50 px-4 py-3">
                      <p className="text-sm text-gray-500">訂單狀態</p>
                      <p className="mt-1 text-lg font-bold text-gray-900">{session.order_status}</p>
                    </div>
                    <div className="rounded-2xl bg-gray-50 px-4 py-3">
                      <p className="text-sm text-gray-500">付款狀態</p>
                      <p className="mt-1 text-lg font-bold text-gray-900">
                        {session.payment_status}
                        </p>
                      </div>
                    </div>

                    {(shouldShowStayNotice || isAllComplimentaryOrder) && (
                      <div className="flex flex-wrap gap-2">
                        {shouldShowStayNotice && (
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                            逾 2 小時
                          </span>
                        )}
                        {isAllComplimentaryOrder && (
                          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">
                            全招待
                          </span>
                        )}
                      </div>
                    )}

                    <div className="rounded-2xl border border-gray-200 p-4">
                      <div className="mb-3">
                        <p className="text-sm font-medium text-gray-600">快速規格</p>
                    </div>

                    <div className="space-y-4">
                      <div>
                        <p className="mb-2 text-sm font-medium text-gray-500">溫度</p>
                        <div className="grid grid-cols-3 gap-2">
                          {TEMP_OPTIONS.map((temp) => (
                            <button
                              key={temp}
                              type="button"
                              onClick={() => setSelectedTemp(temp)}
                              className={`min-h-[50px] rounded-2xl px-3 text-base font-medium transition ${
                                selectedTemp === temp
                                  ? "bg-blue-500 text-white"
                                  : "bg-gray-50 text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                              }`}
                            >
                              {temp}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div>
                        <p className="mb-2 text-sm font-medium text-gray-500">甜度</p>
                        <div className="grid grid-cols-2 gap-2">
                          {SUGAR_OPTIONS.map((sugar) => (
                            <button
                              key={sugar}
                              type="button"
                              onClick={() => setSelectedSugar(sugar)}
                              className={`min-h-[50px] rounded-2xl px-3 text-base font-medium transition ${
                                selectedSugar === sugar
                                  ? "bg-pink-500 text-white"
                                  : "bg-gray-50 text-gray-700 ring-1 ring-gray-200 hover:bg-gray-100"
                              }`}
                            >
                              {sugar}
                            </button>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl bg-gray-50 p-4 text-sm text-gray-700">
                        目前規格：
                        <span className="ml-2 font-semibold text-gray-900">{buildSpecNote()}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-gray-200 p-4">
                    <label className="mb-3 block text-sm font-medium text-gray-600">付款方式</label>
                    <div className="grid grid-cols-3 gap-2">
                      {PAYMENT_METHOD_OPTIONS.map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setPaymentMethod(method)}
                          disabled={isLocked}
                          className={`min-h-[52px] rounded-2xl px-3 text-base font-semibold transition ${
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
                      className="mt-3 min-h-[46px] w-full rounded-2xl bg-sky-100 px-4 text-base font-medium text-sky-900 hover:bg-sky-200 disabled:opacity-60"
                    >
                      {isSavingPaymentMethod ? "儲存中..." : "儲存付款方式"}
                    </button>
                  </div>

                  <div className="rounded-2xl border border-gray-200 p-4">
                    <label className="mb-3 block text-sm font-medium text-gray-600">來客數調整</label>
                    <div className="grid grid-cols-[52px_minmax(0,1fr)_52px] gap-2">
                      <button
                        type="button"
                        onClick={() => updateGuestCount(session.guest_count - 1)}
                        disabled={isLocked || isSavingGuestCount || session.guest_count <= 1}
                        className="h-11 rounded-2xl bg-slate-200 text-lg font-bold text-slate-800 disabled:opacity-50"
                      >
                        -
                      </button>
                      <div className="flex h-11 items-center justify-center rounded-2xl bg-white text-base font-bold text-slate-900 ring-1 ring-slate-200">
                        {session.guest_count}
                      </div>
                      <button
                        type="button"
                        onClick={() => updateGuestCount(session.guest_count + 1)}
                        disabled={isLocked || isSavingGuestCount}
                        className="h-11 rounded-2xl bg-slate-200 text-lg font-bold text-slate-800 disabled:opacity-50"
                      >
                        +
                      </button>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">
                      {isSavingGuestCount ? "儲存中..." : "可直接調整這張訂單的來客數"}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-gray-200 p-4">
                    <label className="mb-3 block text-sm font-medium text-gray-600">客人類型</label>
                    <div className="grid grid-cols-2 gap-2">
                      {CUSTOMER_TYPES.map((type) => (
                        <button
                          key={type}
                          type="button"
                          onClick={() => updateCustomerType(type)}
                          className={`min-h-[52px] rounded-2xl px-3 text-base font-semibold transition ${
                            (session.customer_type ?? "客人") === type
                              ? "bg-orange-400 text-white"
                              : "bg-gray-100 text-gray-700"
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>

                    <div className="mt-4 grid gap-3">
                      <div>
                        <label className="block text-sm font-medium text-gray-600">姓名備註</label>
                        <input
                          type="text"
                          value={customerMemo}
                          onChange={(e) => setCustomerMemo(e.target.value)}
                          placeholder="例如：王小安 / 13:30 預約 / 靠窗"
                          className="mt-2 h-12 w-full rounded-2xl border border-gray-300 bg-white px-4 text-sm outline-none focus:border-amber-500"
                        />
                      </div>

                      <button
                        type="button"
                        onClick={saveCustomerLabel}
                        disabled={isSavingCustomerLabel}
                        className="min-h-[44px] w-full rounded-2xl bg-amber-100 px-4 text-sm font-medium text-amber-900 hover:bg-amber-200 disabled:opacity-60"
                      >
                        {isSavingCustomerLabel ? "儲存中..." : "儲存姓名備註"}
                      </button>
                    </div>
                  </div>

                  {isLocked && (
                    <div className="rounded-2xl bg-green-100 p-4 text-sm font-medium text-green-800">
                      此訂單已結帳，目前建議僅查看。
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="pos-panel flex min-h-0 flex-col rounded-[28px] p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">商品點餐</h2>
                </div>

                    <div className="rounded-2xl bg-gray-50 px-4 py-2.5 text-sm text-gray-600">
                      即點即加
                    </div>
              </div>

              <div className="mb-3 flex flex-wrap gap-2">
                {categoryTabs.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => setActiveCategory(tab)}
                    className={`min-h-[52px] rounded-2xl px-6 text-base font-semibold transition ${
                      activeCategory === tab
                        ? "bg-orange-400 text-white"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              <div className="pos-scroll grid flex-1 auto-rows-[132px] grid-cols-2 gap-3 pr-1 md:auto-rows-[140px]">
                {displayedProducts.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => addOrderItem(product)}
                    disabled={isAdding || isLocked}
                    className="flex h-[132px] flex-col justify-between rounded-[24px] border border-gray-200 bg-white p-4 text-left shadow-sm transition hover:bg-amber-50 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 md:h-[140px]"
                  >
                    <div>
                      <p className="line-clamp-2 min-h-[56px] text-[20px] font-bold leading-snug text-gray-900">
                        {product.name}
                      </p>
                      <p className="mt-1 text-sm text-gray-500">{product.category}</p>
                    </div>

                    <p className="text-2xl font-semibold text-amber-600">${Number(product.price)}</p>
                  </button>
                ))}

                <button
                  type="button"
                  onClick={() => setShowManualSurchargeModal(true)}
                  disabled={isAdding || isLocked}
                  className="flex h-[132px] flex-col justify-between rounded-[24px] border border-rose-200 bg-rose-50 p-4 text-left shadow-sm transition hover:bg-rose-100 hover:shadow-md active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 md:h-[140px]"
                >
                  <div>
                    <p className="line-clamp-2 min-h-[56px] text-[20px] font-bold leading-snug text-gray-900">
                      補價差
                    </p>
                    <p className="mt-1 text-sm text-gray-500">手動輸入金額與原因</p>
                  </div>

                  <p className="text-xl font-semibold text-rose-600">最後一格</p>
                </button>
              </div>
            </section>

            <section className="pos-panel flex min-h-0 flex-col rounded-[28px] shadow-sm md:grid md:grid-rows-[auto_minmax(0,1fr)_auto]">
              <div className="border-b border-gray-100 px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">訂單</h2>
                  </div>

                  <div className="rounded-2xl bg-gray-100 px-4 py-3 text-sm font-semibold text-gray-700">
                    即時訂單
                  </div>
                </div>
              </div>

              <div className="pos-scroll min-h-0 px-4 py-4">
                <div className="space-y-4">
                  {orderItems.length === 0 ? (
                    <div className="rounded-2xl bg-gray-100 p-5 text-base text-gray-500">
                      尚未加點
                    </div>
                  ) : (
                    orderItems.map((item) => {
                      const isComplimentary = Boolean(item.is_complimentary);
                      const isServed = Boolean(item.is_served);
                      const displayLineTotal = isComplimentary ? 0 : Number(item.line_total);

                      return (
                        <div
                          key={item.id}
                          className={`rounded-3xl border p-4 shadow-sm ${
                            isComplimentary
                              ? "border-amber-300 bg-amber-50"
                              : isServed
                                ? "border-emerald-300 bg-emerald-50"
                              : "border-gray-200 bg-white"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start gap-2">
                                <button
                                  type="button"
                                  onClick={() => toggleServed(item)}
                                  disabled={isLocked}
                                  className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border-2 text-sm font-bold transition disabled:opacity-60 ${
                                    isServed
                                      ? "border-emerald-500 bg-emerald-500 text-white"
                                      : "border-slate-300 bg-white text-transparent hover:border-emerald-400"
                                  }`}
                                  aria-label={isServed ? "取消已出餐" : "標記已出餐"}
                                  title={isServed ? "取消已出餐" : "標記已出餐"}
                                >
                                  ✓
                                </button>
                                <p
                                  className={`break-words text-2xl font-bold leading-snug ${
                                    isServed ? "text-emerald-800 line-through decoration-2" : "text-gray-900"
                                  }`}
                                >
                                  {item.product_name}
                                </p>
                                {isServed && (
                                  <span className="rounded-full bg-emerald-200 px-3 py-1 text-xs font-bold text-emerald-900">
                                    已出餐
                                  </span>
                                )}
                                {isComplimentary && (
                                  <span className="rounded-full bg-amber-200 px-3 py-1 text-xs font-bold text-amber-900">
                                    招待
                                  </span>
                                )}
                              </div>

                              <div className="mt-3 space-y-1">
                                <p className="break-words text-base font-medium leading-relaxed text-gray-600">
                                  {item.note || "—"}
                                </p>
                                <p className="text-sm text-gray-500">
                                  ${Number(item.unit_price)} × {item.quantity}
                                </p>
                                {isComplimentary && (
                                  <p className="text-sm font-medium text-amber-700">
                                    本品項不計價
                                  </p>
                                )}
                              </div>
                            </div>

                            <div className="shrink-0 pl-2 text-right">
                              <p className="text-3xl font-bold text-gray-900">
                                ${displayLineTotal}
                              </p>
                            </div>
                          </div>

                          <div className="mt-4 grid grid-cols-[1fr_auto] gap-3">
                            <input
                              value={noteDrafts[item.id] ?? ""}
                              onChange={(e) =>
                                setNoteDrafts((prev) => ({
                                  ...prev,
                                  [item.id]: e.target.value,
                                }))
                              }
                              disabled={isLocked}
                              placeholder="備註"
                              className="h-14 rounded-2xl border border-gray-300 px-4 text-base outline-none focus:border-amber-500 disabled:bg-gray-100"
                            />
                            <button
                              type="button"
                              onClick={() => saveCustomNote(item.id)}
                              disabled={isLocked || savingNoteId === item.id}
                              className="min-h-[56px] rounded-2xl bg-amber-100 px-6 text-base font-semibold text-amber-900 hover:bg-amber-200 disabled:opacity-60"
                            >
                              {savingNoteId === item.id ? "儲存中..." : "存備註"}
                            </button>
                          </div>

                          <div className="mt-4 grid grid-cols-5 gap-2">
                            <button
                              type="button"
                              onClick={() => updateItemQuantity(item, item.quantity - 1)}
                              disabled={isLocked}
                              className="min-h-[52px] rounded-2xl bg-gray-200 px-3 text-xl font-bold text-gray-800 hover:bg-gray-300 disabled:opacity-60"
                            >
                              -1
                            </button>

                            <div className="flex min-h-[52px] items-center justify-center rounded-2xl bg-gray-50 px-3 text-xl font-bold text-gray-900 ring-1 ring-gray-200">
                              {item.quantity}
                            </div>

                            <button
                              type="button"
                              onClick={() => updateItemQuantity(item, item.quantity + 1)}
                              disabled={isLocked}
                              className="min-h-[52px] rounded-2xl bg-blue-500 px-3 text-xl font-bold text-white hover:bg-blue-600 disabled:opacity-60"
                            >
                              +1
                            </button>

                            <button
                              type="button"
                              onClick={() => toggleComplimentary(item)}
                              disabled={isLocked}
                              className={`min-h-[52px] rounded-2xl px-2 text-sm font-semibold leading-tight disabled:opacity-60 ${
                                isComplimentary
                                  ? "bg-amber-500 text-white hover:bg-amber-600"
                                  : "bg-amber-100 text-amber-900 hover:bg-amber-200"
                              }`}
                            >
                              {isComplimentary ? "取消招待" : "設為招待"}
                            </button>

                            <button
                              type="button"
                              onClick={() => removeOrderItem(item.id)}
                              disabled={isLocked}
                              className="min-h-[52px] rounded-2xl bg-red-500 px-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-60"
                            >
                              刪除
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="rounded-b-3xl border-t border-gray-200 bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-gray-700">
                    <span>餐點小計</span>
                    <span>${itemsSubtotal}</span>
                  </div>

                  <div className="flex justify-between text-sm text-gray-700">
                    <span>折扣</span>
                    <span>${Number(session.discount_amount ?? 0)}</span>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      type="number"
                      min={0}
                      value={tipAmountInput}
                      onChange={(e) => setTipAmountInput(e.target.value)}
                      disabled={isLocked}
                      className="h-11 rounded-2xl border border-gray-300 px-4 text-sm outline-none focus:border-amber-500 disabled:bg-gray-100"
                      placeholder="小費金額"
                    />
                    <button
                      type="button"
                      onClick={saveTipAmount}
                      disabled={isLocked || isSavingTip}
                      className="min-h-[44px] rounded-2xl bg-purple-100 px-4 text-sm font-semibold text-purple-900 hover:bg-purple-200 disabled:opacity-60"
                    >
                      {isSavingTip ? "儲存中..." : "儲存小費"}
                    </button>
                  </div>

                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <input
                      type="number"
                      min={0}
                      value={amountReceivedInput}
                      onChange={(e) => setAmountReceivedInput(e.target.value)}
                      disabled={isLocked}
                      className="h-11 rounded-2xl border border-gray-300 px-4 text-sm outline-none focus:border-amber-500 disabled:bg-gray-100"
                      placeholder="實收金額"
                    />
                    <div className="flex min-h-[44px] items-center rounded-2xl bg-gray-100 px-4 text-sm font-semibold text-gray-700">
                      找零 ${changeAmount}
                    </div>
                  </div>

                    <div className="flex items-end justify-between">
                      <div className="space-y-1">
                        <div className="text-base font-bold text-gray-900">
                          總計 ${finalTotal}
                        </div>
                        {isAllComplimentaryOrder && (
                          <div className="text-sm font-semibold text-emerald-700">全招待</div>
                        )}
                        {remainingAmount > 0 && (
                          <div className="text-sm font-semibold text-red-600">
                            尚差 ${remainingAmount}
                          </div>
                        )}
                    </div>
                  </div>
                </div>

                  <button
                    type="button"
                    onClick={openCheckoutModal}
                    disabled={isPaying || isLocked || minimumSpendShortfall > 0}
                    className="mt-3 min-h-[56px] w-full rounded-3xl bg-emerald-500 px-4 text-xl font-bold text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-60"
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
                  {isAllComplimentaryOrder && (
                    <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                      全招待
                    </div>
                  )}
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
                  disabled={isPaying || minimumSpendShortfall > 0}
                  className="min-h-[54px] rounded-2xl bg-emerald-500 px-4 text-base font-semibold text-white hover:bg-emerald-600 disabled:opacity-60"
                >
                {isPaying ? "結帳中..." : "確認結帳"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showManualSurchargeModal && !isLocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl">
            <h3 className="text-2xl font-bold text-gray-900">新增補價差</h3>
            <div className="mt-6 space-y-4">
              <label className="block">
                <span className="text-sm font-medium text-gray-600">補價差金額</span>
                <input
                  type="number"
                  min={0}
                  inputMode="numeric"
                  value={manualSurchargeAmount}
                  onChange={(e) => setManualSurchargeAmount(e.target.value)}
                  className="mt-2 h-12 w-full rounded-2xl border border-gray-300 px-4 text-base outline-none focus:border-rose-400"
                  placeholder="例如：30"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-gray-600">補價差原因</span>
                <textarea
                  value={manualSurchargeReason}
                  onChange={(e) => setManualSurchargeReason(e.target.value)}
                  rows={3}
                  className="mt-2 w-full rounded-2xl border border-gray-300 px-4 py-3 text-sm outline-none focus:border-rose-400"
                  placeholder="例如：升級大杯、加料補差額、特殊客製"
                />
              </label>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowManualSurchargeModal(false);
                  setManualSurchargeAmount("");
                  setManualSurchargeReason("");
                }}
                className="min-h-[54px] rounded-2xl bg-gray-100 px-4 text-base font-semibold text-gray-800 hover:bg-gray-200"
              >
                取消
              </button>
              <button
                type="button"
                onClick={addManualSurcharge}
                disabled={isAdding}
                className="min-h-[54px] rounded-2xl bg-rose-500 px-4 text-base font-semibold text-white hover:bg-rose-600 disabled:opacity-60"
              >
                {isAdding ? "新增中..." : "確認加入"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showTransferSeatModal && !isLocked && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-[28px] bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-sky-600">轉桌</p>
                <h3 className="mt-1 text-2xl font-bold text-slate-900">選擇新的座位</h3>
                <p className="mt-1 text-sm text-slate-500">
                  目前：{formatSeatLabel(currentSeatCodes)}
                  {currentSeatCodes.length > 1 && isCurrentBarSession
                    ? `，請選 ${transferSeatLimit} 個新座位`
                    : "，請選 1 個新座位"}
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  setShowTransferSeatModal(false);
                  setTransferSeatCodes([]);
                }}
                className="h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-700"
              >
                關閉
              </button>
            </div>

            <div className="mt-4 grid max-h-[420px] grid-cols-3 gap-3 overflow-y-auto pr-1 md:grid-cols-4">
              {availableTransferSeats.length === 0 ? (
                <div className="col-span-full rounded-2xl bg-slate-50 p-5 text-sm text-slate-500">
                  目前沒有可轉換的空桌
                </div>
              ) : (
                availableTransferSeats.map((seat) => {
                  const isSelected = transferSeatCodes.includes(seat.seat_code);
                  return (
                    <button
                      key={seat.id}
                      type="button"
                      onClick={() => toggleTransferSeat(seat.seat_code)}
                      className={`rounded-[24px] border px-4 py-5 text-left transition ${
                        isSelected
                          ? "border-sky-400 bg-sky-100 text-sky-900"
                          : "border-slate-200 bg-white text-slate-900 hover:border-sky-300 hover:bg-sky-50"
                      }`}
                    >
                      <p className="text-2xl font-bold">{seat.seat_code.startsWith("A") ? seat.seat_code : `${seat.seat_code}桌`}</p>
                      <p className="mt-1 text-sm text-slate-500">{seat.seat_code.startsWith("A") ? "吧檯座位" : "桌位"}</p>
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-4 rounded-2xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
              新座位：<span className="font-semibold text-slate-900">{formatSeatLabel(transferSeatCodes)}</span>
            </div>

            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setShowTransferSeatModal(false);
                  setTransferSeatCodes([]);
                }}
                className="h-12 flex-1 rounded-2xl bg-slate-100 text-base font-semibold text-slate-700"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleTransferSeat}
                disabled={transferSeatCodes.length === 0 || isTransferringSeat}
                className="h-12 flex-1 rounded-2xl bg-sky-500 text-base font-semibold text-white disabled:opacity-60"
              >
                {isTransferringSeat ? "轉桌中..." : "確認轉桌"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
