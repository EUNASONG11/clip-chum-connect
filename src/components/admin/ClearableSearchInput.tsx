import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ClearableSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
  iconClassName?: string;
  showIcon?: boolean;
  size?: "default" | "sm";
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  id?: string;
  type?: string;
  onClear?: () => void;
}

export function ClearableSearchInput({
  value,
  onChange,
  placeholder,
  className,
  inputClassName,
  iconClassName,
  showIcon = true,
  size = "default",
  onKeyDown,
  id,
  type = "text",
}: ClearableSearchInputProps) {
  return (
    <div className={cn("relative", className)}>
      {showIcon && (
        <Search
          className={cn(
            "absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground",
            size === "sm" ? "left-2.5" : "left-3",
            iconClassName
          )}
        />
      )}
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn(
          showIcon && (size === "sm" ? "pl-9" : "pl-9"),
          "pr-9",
          size === "sm" && "h-8",
          inputClassName
        )}
        onKeyDown={onKeyDown}
      />
      {value.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-0 top-1/2 h-full -translate-y-1/2 px-2 hover:bg-transparent"
          onClick={() => onChange("")}
          aria-label="검색어 지우기"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </Button>
      )}
    </div>
  );
}
