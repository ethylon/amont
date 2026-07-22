import { useState } from "react"

import { Avatar as AvatarPrimitive, AvatarFallback, AvatarImage } from "@/components/ui/primitives/avatar"
import { avatarUrl, githubEmailAvatar, initials, tint } from "@/lib/avatar"
import { cn } from "@/lib/utils"

/* The tinted monogram is the fallback: Base UI keeps it visible until the image loads, so a 404
   (author without a Gravatar) or no network reveals the initials, while GitHub's e-mail lookup
   gets a second chance — resolved, the image comes back with the new source; unresolved (or
   offline), the monogram stays. Keyed by e-mail so a recycled row restarts from the Gravatar. */
export function Avatar(props: { name: string; email: string; className?: string }) {
  return <GravatarAvatar key={props.email} {...props} />
}

function GravatarAvatar({ name, email, className }: { name: string; email: string; className?: string }) {
  const [src, setSrc] = useState(() => avatarUrl(email))
  return (
    <AvatarPrimitive aria-hidden className={cn("size-4.5", className)}>
      {src && (
        <AvatarImage
          src={src}
          alt=""
          onLoadingStatusChange={(status) => {
            if (status !== "error") return
            /* `url !== src` breaks the cycle if the looked-up source itself errors: the cached
               lookup then answers with the URL already in place, and the monogram stays. */
            void githubEmailAvatar(email).then((url) => {
              if (url && url !== src) setSrc(url)
            })
          }}
        />
      )}
      <AvatarFallback
        className="text-[0.5625rem] font-medium text-background"
        style={{ background: tint(name, email) }}
      >
        {initials(name)}
      </AvatarFallback>
    </AvatarPrimitive>
  )
}
