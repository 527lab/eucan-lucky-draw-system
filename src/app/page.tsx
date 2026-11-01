import { DEFAULT_EVENT_NAME } from "@/lib/event";

export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">
        {DEFAULT_EVENT_NAME}
      </h1>
      <p className="text-lg text-zinc-600 dark:text-zinc-400">
        景點合照抽獎系統
      </p>
    </main>
  );
}
