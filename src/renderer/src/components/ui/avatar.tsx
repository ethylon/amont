import { avatarUrl, initials, tint } from "@/lib/avatar"
import { cn } from "@/lib/utils"

/* The image sits on top of the monogram: a 404 (author without a Gravatar) or no network
   removes it and reveals the initials. No state, no layout shift, no render cascade. */
export function Avatar({ name, email, className }: { name: string; email: string; className?: string }) {
  const src = avatarUrl(email)
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-4.5 shrink-0 items-center justify-center overflow-hidden",
        /* neutral border (chroma 0 in both themes): a pale Gravatar doesn't blend into the surface */
        "rounded-full text-[0.5625rem] font-medium text-background ring-1 ring-foreground/10",
        className
      )}
      style={{ background: tint(name, email) }}
    >
      {initials(name)}
      {src && (
        <img
          key={src} // otherwise React would recycle the hidden image of a different author
          src={src}
          alt=""
          className="absolute inset-0 size-full"
          onError={(e) => (e.currentTarget.hidden = true)}
        />
      )}
    </span>
  )
}
