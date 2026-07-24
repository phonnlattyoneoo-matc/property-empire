import type { ReactNode } from "react";

import {
  BOARD_V2_CENTER_GRID_AREA,
  BOARD_V2_COLOR_GROUPS,
  BOARD_V2_SPACES,
  getBoardV2GridPosition,
  isBoardV2Property,
  type BoardV2Space,
} from "@/lib/board-v2";

type PropertyEmpireBoardV2Props = {
  center?: ReactNode;
  renderSpaceOverlay?: (space: BoardV2Space) => ReactNode;
  showIndexes?: boolean;
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(amount);
}

function getSpaceTypeLabel(space: BoardV2Space) {
  switch (space.type) {
    case "free-parking":
      return "Free Parking";
    case "go-to-jail":
      return "Go To Jail";
    default:
      return space.type.replace("-", " ");
  }
}

export function PropertyEmpireBoardV2({
  center,
  renderSpaceOverlay,
  showIndexes = false,
}: PropertyEmpireBoardV2Props) {
  return (
    <section
      aria-label="Property Empire Version 2 board"
      className="relative grid aspect-square w-full min-w-0 grid-cols-[repeat(11,minmax(0,1fr))] grid-rows-[repeat(11,minmax(0,1fr))] overflow-visible border-2 border-[#171915] bg-[#171915] shadow-[8px_8px_0_0_#f9c74f]"
      data-board-version="2"
    >
      {BOARD_V2_SPACES.map((space) => {
        const position = getBoardV2GridPosition(space.index);
        const propertyGroup = isBoardV2Property(space)
          ? BOARD_V2_COLOR_GROUPS[space.colorGroup]
          : null;

        return (
          <article
            aria-label={`${space.title}. ${space.description}`}
            className="relative flex min-h-0 min-w-0 flex-col overflow-hidden border border-[#171915] bg-white p-[clamp(0.12rem,0.45vw,0.35rem)] text-[#171915]"
            data-board-index={space.index}
            data-board-side={position.side}
            data-board-space-id={space.id}
            data-board-space-type={space.type}
            key={space.id}
            style={{
              gridColumn: position.column,
              gridRow: position.row,
            }}
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 h-[clamp(0.16rem,0.45vw,0.35rem)] border-b border-[#171915]"
              style={{ backgroundColor: space.color }}
            />
            {showIndexes ? (
              <span className="absolute left-0 top-0 z-10 border-b border-r border-[#171915] bg-white px-[clamp(0.1rem,0.3vw,0.25rem)] py-[clamp(0.04rem,0.12vw,0.1rem)] text-[clamp(0.3rem,0.58vw,0.48rem)] font-black leading-none">
                {space.index}
              </span>
            ) : null}

            <div
              className={`mt-[clamp(0.18rem,0.5vw,0.42rem)] flex min-w-0 items-start justify-between gap-1 ${
                showIndexes ? "pt-[clamp(0.2rem,0.5vw,0.42rem)]" : ""
              }`}
            >
              <h3 className="min-w-0 break-words text-[clamp(0.28rem,0.88vw,0.72rem)] font-black uppercase leading-none">
                {space.title}
              </h3>
              <span
                aria-hidden="true"
                className="hidden shrink-0 border border-[#171915] px-1 py-0.5 text-[clamp(0.28rem,0.58vw,0.48rem)] font-black leading-none sm:inline-block"
                style={{ backgroundColor: space.color }}
              >
                {space.icon}
              </span>
            </div>

            <p className="mt-auto hidden text-[clamp(0.28rem,0.62vw,0.52rem)] font-black uppercase leading-tight text-[#596057] sm:block">
              {propertyGroup?.name ?? getSpaceTypeLabel(space)}
            </p>

            {isBoardV2Property(space) ? (
              <p className="hidden text-[clamp(0.28rem,0.62vw,0.52rem)] font-bold leading-tight text-[#445045] sm:block">
                {formatCurrency(space.purchasePrice)} | Rent{" "}
                {formatCurrency(space.baseRent)}
              </p>
            ) : null}

            {renderSpaceOverlay?.(space)}
          </article>
        );
      })}

      <div
        className="relative flex min-h-0 min-w-0 items-center justify-center overflow-hidden border-2 border-[#171915] bg-[#f7f8f4] p-[clamp(0.75rem,3vw,2.5rem)] text-center"
        data-board-v2-center
        style={BOARD_V2_CENTER_GRID_AREA}
      >
        {center ?? (
          <div>
            <p className="text-xs font-black uppercase text-[#596057]">
              Property Empire
            </p>
            <h2 className="mt-2 text-[clamp(1.25rem,5vw,4rem)] font-black leading-none">
              City Center
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm font-bold text-[#445045]">
              Reserved for future dice, movement, event, and payment animations.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
