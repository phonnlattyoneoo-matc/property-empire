"use client";

import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f7f8f4] px-6 py-16 text-[#171915]">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,25,21,0.05)_1px,transparent_1px),linear-gradient(rgba(23,25,21,0.05)_1px,transparent_1px)] bg-[size:44px_44px]"
      />

      <div
        aria-hidden="true"
        className="absolute left-1/2 top-12 h-[560px] w-[560px] -translate-x-1/2 rotate-45 border-[18px] border-[#171915] opacity-[0.04]"
      />

      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 right-0 flex h-40 items-end justify-center gap-2 px-8 opacity-80"
      >
        <span className="h-16 w-10 bg-[#3454d1]" />
        <span className="h-24 w-12 bg-[#f9c74f]" />
        <span className="h-12 w-10 bg-[#43aa8b]" />
        <span className="h-32 w-14 bg-[#ef476f]" />
        <span className="h-20 w-12 bg-[#118ab2]" />
        <span className="h-28 w-10 bg-[#f8961e]" />
        <span className="h-14 w-12 bg-[#06d6a0]" />
      </div>

      <section className="relative z-10 flex max-w-4xl flex-col items-center text-center">
        <p className="mb-6 h-1.5 w-28 bg-[#ef476f]" aria-hidden="true" />
        <h1 className="text-5xl font-black tracking-normal text-[#171915] sm:text-7xl">
          Property Empire
        </h1>
        <p className="mt-6 max-w-2xl text-xl font-medium leading-8 text-[#445045] sm:text-2xl">
          Build your empire. Bankrupt your friends.
        </p>
        <div className="mt-10 grid w-full max-w-xl gap-4 sm:grid-cols-2">
          <button
            className="flex h-14 items-center justify-center border-2 border-[#171915] bg-[#171915] px-8 text-base font-bold text-white shadow-[8px_8px_0_0_#f9c74f] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#f9c74f]/60"
            onClick={() => router.push("/setup")}
            type="button"
          >
            Local Game
          </button>
          <button
            className="flex h-14 items-center justify-center border-2 border-[#171915] bg-[#06d6a0] px-8 text-base font-bold text-[#171915] shadow-[8px_8px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/45"
            onClick={() => router.push("/online")}
            type="button"
          >
            Online Game
          </button>
        </div>
      </section>
    </main>
  );
}
