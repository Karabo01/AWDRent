import { Input } from "@/components/ui/input";

/** GET form that sets ?q= on the current page. Works without JavaScript. */
export function SearchBox({ placeholder, defaultValue }: { placeholder: string; defaultValue?: string }) {
  return (
    <form role="search" className="max-w-sm">
      <Input type="search" name="q" placeholder={placeholder} defaultValue={defaultValue} aria-label={placeholder} />
    </form>
  );
}
