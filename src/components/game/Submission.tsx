"use client";

import { useRef, useState } from "react";
import { useGame } from "@/components/GameProvider";
import { Button, Avatar } from "@/components/ui";
import { fileToDownscaledDataUrl } from "@/lib/image";

export function Submission() {
  const { state, isHost, me, submitPhoto, clearMyPhotos, startGame } = useGame();
  const fileRef = useRef<HTMLInputElement>(null);
  const [previews, setPreviews] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startBusy, setStartBusy] = useState(false);

  if (!state || !state.submission) {
    return null;
  }
  const { submission } = state;
  const readyCount = submission.submittedPlayerIds.length;

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        const dataUrl = await fileToDownscaledDataUrl(file);
        await submitPhoto(dataUrl);
        setPreviews((p) => [...p, dataUrl]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (fileRef.current) {
        fileRef.current.value = "";
      }
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-5 py-10">
      <div className="text-center">
        <h1 className="text-3xl font-black">📸 Submit your photos</h1>
        <p className="mt-2 text-white/60">
          Upload a baby photo (or any guess-worthy pic) of yourself. Everyone
          will try to match it to you.
        </p>
      </div>

      <div className="card mt-8 p-6">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleFiles(e.target.files)}
        />
        <Button
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="w-full"
        >
          {busy ? "Uploading…" : "+ Add a photo"}
        </Button>

        <p className="mt-3 text-center text-sm text-white/60">
          You&apos;ve submitted{" "}
          <span className="font-bold text-white">{submission.myPhotoCount}</span>{" "}
          photo{submission.myPhotoCount === 1 ? "" : "s"}.
        </p>

        {previews.length > 0 && (
          <>
            <div className="mt-4 grid grid-cols-3 gap-2">
              {previews.map((src, i) => (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  key={i}
                  src={src}
                  alt="Your submission"
                  className="aspect-square w-full rounded-lg object-cover"
                />
              ))}
            </div>
            <button
              onClick={async () => {
                await clearMyPhotos();
                setPreviews([]);
              }}
              className="mt-3 w-full text-sm text-red-300/80 hover:text-red-300"
            >
              Clear my photos
            </button>
          </>
        )}
        {error && (
          <p className="mt-3 text-center text-sm text-red-300">{error}</p>
        )}
      </div>

      <div className="card mt-6 p-6">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-white/60">
          Who&apos;s ready ({readyCount}/{state.players.length})
        </h2>
        <ul className="space-y-2">
          {state.players.map((p) => {
            const ready = submission.submittedPlayerIds.includes(p.id);
            return (
              <li key={p.id} className="flex items-center gap-3">
                <Avatar name={p.name} color={p.color} size={28} dimmed={!ready} />
                <span className={ready ? "font-medium" : "text-white/50"}>
                  {p.name}
                  {p.id === me?.id && " (you)"}
                </span>
                <span className="ml-auto">
                  {ready ? (
                    <span className="text-emerald-400">
                      ✓ {p.photoCount}
                    </span>
                  ) : (
                    <span className="text-white/30">…</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {isHost && (
        <div className="mt-8 text-center">
          <Button
            onClick={async () => {
              setStartBusy(true);
              setError(null);
              try {
                await startGame();
              } catch (e) {
                setError(e instanceof Error ? e.message : "Couldn't start.");
              } finally {
                setStartBusy(false);
              }
            }}
            disabled={startBusy || readyCount < 2}
            className="w-full max-w-sm"
          >
            {readyCount < 2
              ? "Need photos from 2+ people"
              : `Start the game (${submission.totalPhotos} rounds) →`}
          </Button>
        </div>
      )}
    </div>
  );
}
