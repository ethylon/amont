import { avatarUrl, initials, tint } from "@/lib/avatar"
import { cn } from "@/lib/utils"

/* L'image se pose par-dessus le monogramme : un 404 (auteur sans Gravatar) ou l'absence de réseau
   la retire et découvre les initiales. Ni état, ni saut de mise en page, ni cascade de rendus. */
export function Avatar({ name, email, className }: { name: string; email: string; className?: string }) {
  const src = avatarUrl(email)
  return (
    <span
      aria-hidden
      className={cn(
        "relative flex size-4.5 shrink-0 items-center justify-center overflow-hidden",
        "rounded-full text-[0.5625rem] font-medium text-background",
        className
      )}
      style={{ background: tint(name, email) }}
    >
      {initials(name)}
      {src && (
        <img
          key={src} // sans quoi React recyclerait l'image masquée d'un autre auteur
          src={src}
          alt=""
          className="absolute inset-0 size-full"
          onError={(e) => (e.currentTarget.hidden = true)}
        />
      )}
    </span>
  )
}
