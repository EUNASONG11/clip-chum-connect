import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, X } from "lucide-react";

interface CohortMultiSelectProps {
  options: string[];
  selected: string[];
  onChange: (selected: string[]) => void;
  placeholder?: string;
  noneLabel?: string;
  width?: string;
  /** 필터가 아닌 실제 배정용: "기수 전체"/"미지정" 항목을 숨깁니다. */
  assignMode?: boolean;
  allLabel?: string;
}

export function CohortMultiSelect({
  options,
  selected,
  onChange,
  placeholder = "기수 전체",
  noneLabel = "미지정",
  width = "w-full sm:w-44",
  assignMode = false,
  allLabel = "기수 전체",
}: CohortMultiSelectProps) {
  const allSelected = assignMode
    ? selected.length === options.length
    : selected.length === options.length + 1;

  const toggleAll = () => {
    if (allSelected) {
      onChange([]);
    } else {
      onChange(assignMode ? [...options] : ["__none__", ...options]);
    }
  };


  const toggleValue = (value: string) => {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
    } else {
      onChange([...selected, value]);
    }
  };

  const clear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange([]);
  };

  const display = useMemo(() => {
    if (selected.length === 0) return placeholder;
    if (allSelected) return allLabel;
    const labels = selected
      .slice(0, 2)
      .map((v) => (v === "__none__" ? noneLabel : v));
    return (
      labels.join(", ") + (selected.length > 2 ? ` +${selected.length - 2}` : "")
    );
  }, [selected, allSelected, allLabel, placeholder, noneLabel]);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={`h-9 justify-between ${width} px-3 font-normal`}
        >
          <span className="truncate">{display}</span>
          <span className="flex shrink-0 items-center gap-1">
            {selected.length > 0 && (
              <Badge
                variant="secondary"
                className="h-5 px-1 text-[10px] hover:bg-secondary/80"
                onClick={clear}
              >
                {selected.length}
                <X className="ml-0.5 h-3 w-3" />
              </Badge>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-48" align="start">
        <DropdownMenuCheckboxItem
          checked={allSelected}
          onCheckedChange={toggleAll}
        >
          {allLabel}
        </DropdownMenuCheckboxItem>
        {!assignMode && (
          <DropdownMenuCheckboxItem
            checked={selected.includes("__none__")}
            onCheckedChange={() => toggleValue("__none__")}
          >
            {noneLabel}
          </DropdownMenuCheckboxItem>
        )}

        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option}
            checked={selected.includes(option)}
            onCheckedChange={() => toggleValue(option)}
          >
            {option}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
