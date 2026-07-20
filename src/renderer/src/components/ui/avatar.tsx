import { avatarUrl, githubEmailAvatar, initials, tint } from "@/lib/avatar"
import { cn } from "@/lib/utils"

/* The image sits on top of the monogram: a 404 (author without a Gravatar) or no network hides
   it and reveals the initials, while GitHub's e-mail lookup gets a second chance — resolved, the
   image comes back with the new source; unresolved (or offline), the monogram stays. Still no
   state, no layout shift, no render cascade: the swap touches the <img> node alone. */
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
          onError={(e) => {
            const img = e.currentTarget
            img.hidden = true
            /* `src !== url` breaks the cycle if the looked-up source itself errors: the cached
               lookup then answers with the URL already in place, and the image stays hidden. */
            void githubEmailAvatar(email).then((url) => {
              if (url && img.isConnected && img.src !== url) {
                img.src = url
                img.hidden = false
              }
            })
          }}
        />
      )}
    </span>
  )
}
