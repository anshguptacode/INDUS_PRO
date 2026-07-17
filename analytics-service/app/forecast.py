"""7-day engagement forecast.

Primary model: SARIMAX(2,0,1)x(1,0,0,7) on daily engagement.
Falls back to seasonal-naive (same weekday mean, recency weighted) when
statsmodels is unavailable or the series is too short/degenerate.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

HORIZON = 7


def _daily_series(df: pd.DataFrame) -> pd.Series:
    df = df.copy()
    df["engagement"] = df["likes"] + df["comments"] + df["shares"]
    daily = (df.set_index("posted_at")["engagement"]
               .resample("D").sum())
    # keep the last 120 days; fill silent days with 0 activity
    return daily.iloc[-120:].fillna(0.0)


def _seasonal_naive(daily: pd.Series) -> tuple[np.ndarray, float]:
    weights = np.linspace(0.5, 1.5, len(daily))
    by_dow = {}
    for dow in range(7):
        mask = daily.index.dayofweek == dow
        vals, w = daily[mask].values, weights[mask]
        by_dow[dow] = float(np.average(vals, weights=w)) if len(vals) else float(daily.mean())
    start = daily.index[-1] + pd.Timedelta(days=1)
    preds = np.array([by_dow[(start + pd.Timedelta(days=i)).dayofweek]
                      for i in range(HORIZON)])
    return preds, float(daily.std() or daily.mean() or 1.0)


def forecast(df: pd.DataFrame) -> list[dict]:
    if df.empty:
        return []
    daily = _daily_series(df)
    if len(daily) < 14:
        return []

    preds, resid_std, model_name = None, None, "seasonal_naive"
    if len(daily) >= 28:
        try:
            from statsmodels.tsa.statespace.sarimax import SARIMAX
            model = SARIMAX(daily.values, order=(2, 0, 1),
                            seasonal_order=(1, 0, 0, 7),
                            enforce_stationarity=False,
                            enforce_invertibility=False)
            fit = model.fit(disp=False, maxiter=200)
            raw = fit.forecast(HORIZON)
            if np.all(np.isfinite(raw)):
                preds = np.clip(raw, 0, None)
                resid_std = float(np.std(fit.resid[-28:]) or daily.std() or 1.0)
                model_name = "sarimax(2,0,1)(1,0,0,7)"
        except Exception as exc:  # noqa: BLE001 - any model failure -> fallback
            log.warning("SARIMAX failed, using seasonal naive: %s", exc)

    if preds is None:
        preds, resid_std = _seasonal_naive(daily)

    mean = float(daily.iloc[-28:].mean()) or 1.0
    start = daily.index[-1] + pd.Timedelta(days=1)
    out = []
    for i, value in enumerate(preds):
        value = float(value)
        low = float(np.maximum(0.2 * mean, value - 0.8 * resid_std))
        high = float(value + 0.8 * resid_std)
        out.append({
            "target_date": (start + pd.Timedelta(days=i)).date().isoformat(),
            "predicted": round(value, 1),
            "predicted_low": round(low, 1),
            "predicted_high": round(high, 1),
            "model": model_name,
        })
    return out
