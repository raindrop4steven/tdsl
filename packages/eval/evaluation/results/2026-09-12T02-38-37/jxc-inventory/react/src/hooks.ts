// 自动生成：数据绑定 hooks（TDSL useQuery/useMutation）
import { useEffect, useRef, useState } from 'react';

export interface QueryState<T> {
  data: T | null;
  loading: boolean;
  error: unknown;
  refetch: () => void;
}

export function useQuery<T>(fn: () => Promise<T>, deps: unknown[] = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  // 卸载保护：异步回填不再触碰已卸载组件（控制台 React 状态更新警告）
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  useEffect(() => {
    alive.current = true;
    setLoading(true);
    fn()
      .then((d) => {
        if (alive.current) setData(d);
        setError(null);
      })
      .catch((e) => {
        if (alive.current) setError(e);
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, [...deps, tick]);

  const refetch = () => setTick((t) => t + 1);
  return { data, loading, error, refetch };
}

export function useMutation<T extends unknown[], R>(fn: (...args: T) => Promise<R>) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const mutate = async (...args: T): Promise<R | undefined> => {
    try {
      setLoading(true);
      setError(null);
      const r = await fn(...args);
      return r;
    } catch (e) {
      if (alive.current) setError(e);
      return undefined;
    } finally {
      if (alive.current) setLoading(false);
    }
  };

  return { mutate, loading, error };
}
