"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import {
  GAME_SESSION_STORAGE_KEY,
  MAX_PLAYERS,
  MIN_PLAYERS,
  createGameState,
  parsePlayerNames,
} from "@/lib/game-state";

type Player = {
  id: number;
  name: string;
};

export default function SetupPage() {
  const router = useRouter();
  const [nextId, setNextId] = useState(3);
  const [players, setPlayers] = useState<Player[]>([
    { id: 1, name: "" },
    { id: 2, name: "" },
  ]);

  const canAddPlayer = players.length < MAX_PLAYERS;
  const canRemovePlayer = players.length > MIN_PLAYERS;
  const canBeginGame = useMemo(
    () => players.every((player) => player.name.trim().length > 0),
    [players],
  );

  function addPlayer() {
    if (!canAddPlayer) {
      return;
    }

    setPlayers((currentPlayers) => [
      ...currentPlayers,
      { id: nextId, name: "" },
    ]);
    setNextId((currentId) => currentId + 1);
  }

  function removePlayer(id: number) {
    if (!canRemovePlayer) {
      return;
    }

    setPlayers((currentPlayers) =>
      currentPlayers.filter((player) => player.id !== id),
    );
  }

  function updatePlayerName(id: number, name: string) {
    setPlayers((currentPlayers) =>
      currentPlayers.map((player) =>
        player.id === id ? { ...player, name } : player,
      ),
    );
  }

  function beginGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!canBeginGame) {
      return;
    }

    const playerNames = parsePlayerNames(
      players.map((player) => player.name),
    );

    if (!playerNames) {
      return;
    }

    sessionStorage.setItem(
      GAME_SESSION_STORAGE_KEY,
      JSON.stringify(createGameState(playerNames)),
    );
    router.push("/game");
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f7f8f4] px-5 py-8 text-[#171915] sm:px-8 sm:py-12">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(90deg,rgba(23,25,21,0.05)_1px,transparent_1px),linear-gradient(rgba(23,25,21,0.05)_1px,transparent_1px)] bg-[size:44px_44px]"
      />

      <div
        aria-hidden="true"
        className="absolute -right-36 top-10 h-[360px] w-[360px] rotate-45 border-[14px] border-[#171915] opacity-[0.04] sm:h-[520px] sm:w-[520px]"
      />

      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 right-0 flex h-32 items-end justify-center gap-2 px-8 opacity-70"
      >
        <span className="h-14 w-9 bg-[#3454d1]" />
        <span className="h-24 w-11 bg-[#f9c74f]" />
        <span className="h-12 w-9 bg-[#43aa8b]" />
        <span className="h-28 w-12 bg-[#ef476f]" />
        <span className="h-20 w-11 bg-[#118ab2]" />
        <span className="h-24 w-9 bg-[#f8961e]" />
        <span className="h-14 w-11 bg-[#06d6a0]" />
      </div>

      <section className="relative z-10 mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col justify-center py-8">
        <Link
          className="mb-10 inline-flex h-11 w-fit items-center border-2 border-[#171915] bg-[#f7f8f4] px-5 text-sm font-bold text-[#171915] shadow-[5px_5px_0_0_#43aa8b] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#43aa8b]/45"
          href="/"
        >
          Back
        </Link>

        <div className="grid items-start gap-10 lg:grid-cols-[0.82fr_1.18fr]">
          <div>
            <p className="mb-5 h-1.5 w-24 bg-[#ef476f]" aria-hidden="true" />
            <h1 className="text-4xl font-black tracking-normal sm:text-6xl">
              Set Up Players
            </h1>
            <p className="mt-5 max-w-md text-lg font-medium leading-8 text-[#445045]">
              Name the rivals before the bidding starts.
            </p>
          </div>

          <form
            className="border-2 border-[#171915] bg-white/88 p-4 shadow-[10px_10px_0_0_#f9c74f] backdrop-blur sm:p-6"
            onSubmit={beginGame}
          >
            <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-2xl font-black">Players</h2>
                <p className="mt-1 text-sm font-bold text-[#445045]">
                  {players.length} of {MAX_PLAYERS}
                </p>
              </div>

              <button
                className="h-11 border-2 border-[#171915] bg-[#3454d1] px-5 text-sm font-bold text-white shadow-[5px_5px_0_0_#171915] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#3454d1]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057] disabled:shadow-none"
                disabled={!canAddPlayer}
                onClick={addPlayer}
                type="button"
              >
                Add Player
              </button>
            </div>

            <div className="space-y-4">
              {players.map((player, index) => (
                <div
                  className="grid gap-3 border-2 border-[#171915] bg-[#f7f8f4] p-3 sm:grid-cols-[1fr_auto] sm:items-end"
                  key={player.id}
                >
                  <label className="block">
                    <span className="mb-2 block text-sm font-black uppercase">
                      Player {index + 1}
                    </span>
                    <input
                      className="h-12 w-full border-2 border-[#171915] bg-white px-4 text-base font-bold text-[#171915] outline-none transition-shadow placeholder:text-[#8b9387] focus:shadow-[0_0_0_4px_rgba(249,199,79,0.45)]"
                      maxLength={24}
                      onChange={(event) =>
                        updatePlayerName(player.id, event.target.value)
                      }
                      placeholder="Enter name"
                      type="text"
                      value={player.name}
                    />
                  </label>

                  <button
                    aria-label={`Remove player ${index + 1}`}
                    className="h-12 border-2 border-[#171915] bg-[#ef476f] px-4 text-sm font-bold text-white transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#ef476f]/35 disabled:cursor-not-allowed disabled:bg-[#c6cbbf] disabled:text-[#596057]"
                    disabled={!canRemovePlayer}
                    onClick={() => removePlayer(player.id)}
                    type="button"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <button
              className="mt-7 h-14 w-full border-2 border-[#171915] bg-[#171915] px-8 text-base font-bold text-white shadow-[8px_8px_0_0_#06d6a0] transition-transform hover:-translate-y-0.5 focus:outline-none focus:ring-4 focus:ring-[#06d6a0]/40 disabled:cursor-not-allowed disabled:bg-[#596057] disabled:opacity-55 disabled:shadow-none"
              disabled={!canBeginGame}
              type="submit"
            >
              Begin Game
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
