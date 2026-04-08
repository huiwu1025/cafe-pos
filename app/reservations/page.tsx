"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

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
};

type ReservationSeatRow = {
  reservation_id: string;
  seats: { seat_code: string } | { seat_code: string }[] | null;
  reservations:
    | {
        id: string;
        reservation_code: string;
        reservation_name: string;
        reservation_phone: string;
        reservation_date: string;
        reservation_time: string;
        guest_count: number;
        notes: string | null;
        status: string;
      }
    | {
        id: string;
        reservation_code: string;
        reservation_name: string;
        reservation_phone: string;
        reservation_date: string;
        reservation_time: string;
        guest_count: number;
        notes: string | null;
        status: string;
      }[]
    | null;
};

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

function normalizeTimeLabel(value: string) {
  return String(value).slice(0, 5);
}

function normalizePhone(value: string) {
  return value.replace(/\D/g, "");
}

async function addReservationToBlacklist(reservation: ReservationInfo) {
  const trimmedPhone = normalizePhone(reservation.reservationPhone);
  const trimmedName = reservation.reservationName.trim();

  try {
    const { data: existingRows, error: lookupError } = await supabase
      .from("blacklist_customers")
      .select("id, customer_name, customer_phone, strike_count")
      .limit(200);

    if (lookupError) throw lookupError;

    const existingMatch = (existingRows ?? []).find((row) => {
      const rowPhone = normalizePhone(row.customer_phone ?? "");
      const rowName = row.customer_name?.trim() ?? "";
      return (trimmedPhone && rowPhone === trimmedPhone) || (trimmedName && rowName === trimmedName);
    });

    if (existingMatch) {
      const { error: updateError } = await supabase
        .from("blacklist_customers")
        .update({
          customer_name: trimmedName || existingMatch.customer_name,
          customer_phone: trimmedPhone || existingMatch.customer_phone,
          strike_count: Number(existingMatch.strike_count ?? 0) + 1,
          last_reason: "no_show",
          last_flagged_at: new Date().toISOString(),
        })
        .eq("id", existingMatch.id);

      if (updateError) throw updateError;
      return;
    }

    const { error: insertError } = await supabase.from("blacklist_customers").insert({
      customer_name: trimmedName || null,
      customer_phone: trimmedPhone || null,
      strike_count: 1,
      last_reason: "no_show",
      last_flagged_at: new Date().toISOString(),
      notes: `預約 ${reservation.reservationCode} 標記逾時未到`,
    });

    if (insertError) throw insertError;
  } catch (error) {
    const maybeError = error as { message?: string };
    if (maybeError?.message?.includes("blacklist_customers")) {
      throw new Error("BLACKLIST_TABLE_MISSING");
    }
    throw error;
  }
}

export default function ReservationsPage() {
  const router = useRouter();
  const [reservations, setReservations] = useState<ReservationInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const loadReservations = useCallback(async () => {
    try {
      setIsLoading(true);
      const { data, error } = await supabase
        .from("reservation_seats")
        .select(`
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
            status
          )
        `);

      if (error) throw error;

      const today = todayIsoDate();
      const reservationMap = new Map<string, ReservationInfo>();

      for (const row of (data ?? []) as ReservationSeatRow[]) {
        const reservation = Array.isArray(row.reservations) ? row.reservations[0] : row.reservations;
        const seat = Array.isArray(row.seats) ? row.seats[0] : row.seats;

        if (
          !reservation?.id ||
          !seat?.seat_code ||
          reservation.status !== "reserved" ||
          reservation.reservation_date !== today
        ) {
          continue;
        }

        const existing = reservationMap.get(reservation.id);
        if (existing) {
          existing.seatCodes.push(seat.seat_code);
          continue;
        }

        reservationMap.set(reservation.id, {
          reservationId: reservation.id,
          reservationCode: reservation.reservation_code,
          reservationName: reservation.reservation_name,
          reservationPhone: reservation.reservation_phone,
          reservationDate: reservation.reservation_date,
          reservationTime: normalizeTimeLabel(reservation.reservation_time),
          guestCount: Number(reservation.guest_count ?? 0),
          notes: reservation.notes ?? "",
          seatCodes: [seat.seat_code],
        });
      }

      const nextReservations = Array.from(reservationMap.values())
        .map((reservation) => ({
          ...reservation,
          seatCodes: [...reservation.seatCodes].sort(sortSeatCodes),
        }))
        .sort((a, b) => a.reservationTime.localeCompare(b.reservationTime));

      setReservations(nextReservations);
    } catch (error) {
      console.error("Failed to load reservations", error);
      alert("讀取今日預約失敗");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReservations();
  }, [loadReservations]);

  const stats = useMemo(
    () => ({
      count: reservations.length,
      guests: reservations.reduce((sum, item) => sum + item.guestCount, 0),
    }),
    [reservations]
  );

  async function updateReservationStatus(
    reservation: ReservationInfo,
    status: "cancelled" | "no_show"
  ) {
    const confirmed = window.confirm(
      status === "cancelled" ? "確定要取消這筆預約嗎？" : "確定要將這筆預約標記為逾時未到嗎？"
    );
    if (!confirmed) return;

    try {
      setUpdatingId(reservation.reservationId);

      const { error } = await supabase
        .from("reservations")
        .update({ status })
        .eq("id", reservation.reservationId);

      if (error) throw error;

      if (status === "no_show") {
        await addReservationToBlacklist(reservation);
        alert("已標記逾時，並加入黑名單提醒");
      } else {
        alert("已取消預約");
      }

      await loadReservations();
    } catch (error) {
      console.error("Failed to update reservation status", error);
      if (error instanceof Error && error.message === "BLACKLIST_TABLE_MISSING") {
        alert(
          "已標記逾時，但黑名單資料表尚未建立。請先在 Supabase 執行 supabase/20260408_blacklist_customers.sql"
        );
        await loadReservations();
        return;
      }
      alert("更新預約狀態失敗");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <main className="pos-shell p-3 md:p-4">
      <div className="mx-auto flex h-full max-w-[1600px] flex-col gap-3">
        <header className="pos-panel rounded-[28px] px-4 py-3 lg:px-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-fuchsia-700">
                Reservation Board
              </p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 lg:text-3xl">今日預約</h1>
            </div>
            <div className="grid grid-cols-3 gap-2 lg:flex">
              <button
                type="button"
                onClick={() => router.push("/")}
                className="h-11 rounded-2xl bg-slate-100 px-4 text-sm font-semibold text-slate-800"
              >
                返回座位
              </button>
              <button
                type="button"
                onClick={() => router.push("/orders")}
                className="h-11 rounded-2xl bg-sky-100 px-4 text-sm font-semibold text-sky-900"
              >
                歷史訂單
              </button>
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="h-11 rounded-2xl bg-emerald-100 px-4 text-sm font-semibold text-emerald-900"
              >
                今日後台
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 lg:max-w-[360px]">
            <div className="rounded-[20px] bg-slate-50 px-3 py-3">
              <p className="text-[11px] text-slate-500">今日預約筆數</p>
              <p className="mt-1 text-2xl font-bold text-fuchsia-700">{stats.count} 筆</p>
            </div>
            <div className="rounded-[20px] bg-slate-50 px-3 py-3">
              <p className="text-[11px] text-slate-500">今日預約來客</p>
              <p className="mt-1 text-2xl font-bold text-sky-700">{stats.guests} 人</p>
            </div>
          </div>
        </header>

        <section className="pos-panel min-h-0 flex-1 rounded-[28px] p-3 lg:p-4">
          {isLoading ? (
            <div className="rounded-[22px] bg-slate-50 p-4 text-sm text-slate-500">讀取中...</div>
          ) : reservations.length === 0 ? (
            <div className="rounded-[22px] bg-slate-50 p-4 text-sm text-slate-500">今天沒有尚未處理的預約</div>
          ) : (
            <div className="pos-scroll grid min-h-0 gap-3 pr-1 lg:grid-cols-2">
              {reservations.map((reservation) => {
                const isUpdating = updatingId === reservation.reservationId;

                return (
                  <div
                    key={reservation.reservationId}
                    className="rounded-[24px] border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-lg font-bold text-slate-900">
                          {reservation.reservationTime} {reservation.reservationName}
                        </p>
                        <p className="mt-1 text-sm text-slate-500">{reservation.reservationPhone}</p>
                      </div>
                      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">
                        {reservation.reservationCode}
                      </span>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                      <InfoMini label="座位" value={formatSeatLabel(reservation.seatCodes)} />
                      <InfoMini label="人數" value={`${reservation.guestCount} 人`} />
                      <InfoMini label="日期" value={reservation.reservationDate} />
                    </div>

                    <div className="mt-3 rounded-[18px] bg-white px-3 py-3 text-sm text-slate-600">
                      {reservation.notes || "無備註"}
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => updateReservationStatus(reservation, "cancelled")}
                        className="h-11 rounded-2xl bg-rose-100 px-3 text-sm font-semibold text-rose-800 hover:bg-rose-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isUpdating ? "處理中..." : "取消預約"}
                      </button>
                      <button
                        type="button"
                        disabled={isUpdating}
                        onClick={() => updateReservationStatus(reservation, "no_show")}
                        className="h-11 rounded-2xl bg-slate-200 px-3 text-sm font-semibold text-slate-800 hover:bg-slate-300 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {isUpdating ? "處理中..." : "標記逾時"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function InfoMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] bg-white px-3 py-3">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}
