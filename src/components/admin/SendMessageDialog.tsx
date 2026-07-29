import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { listNonWatchers, sendClassSms, sendClassBrandTalk } from "@/lib/sms.functions";
import { listClassVideos } from "@/lib/classes.functions";

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  classId: string;
};

export function SendMessageDialog({ open, onOpenChange, classId }: Props) {
  const [mode, setMode] = useState<"video" | "class">("video");
  const [videoId, setVideoId] = useState<string>("");
  const [channel, setChannel] = useState<"sms" | "brandtalk">("sms");
  const [message, setMessage] = useState("");
  
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);

  const { data: videos = [] } = useQuery({
    queryKey: ["admin", "class", classId, "videos-lite"],
    queryFn: () => listClassVideos({ data: { classId } }),
    enabled: open,
  });

  const effectiveVideoId = mode === "video" ? videoId : undefined;

  const {
    data: nonWatchersData,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["non-watchers", classId, effectiveVideoId ?? "__all__"],
    queryFn: () =>
      listNonWatchers({
        data: { classId, ...(effectiveVideoId ? { videoId: effectiveVideoId } : {}) },
      }),
    enabled: open && (mode === "class" || !!videoId),
  });
  const nonWatchers = nonWatchersData ?? [];

  useEffect(() => {
    if (!open || !nonWatchersData) return;
    // 기본: 전화번호 있는 학생 전체 선택
    const init: Record<string, boolean> = {};
    nonWatchersData.forEach((n: any) => {
      if (n.phone) init[n.user_id] = true;
    });
    setSelected(init);
  }, [open, nonWatchersData]);

  useEffect(() => {
    if (open && mode === "video" && !videoId && videos.length > 0) {
      setVideoId((videos[0] as any).id);
    }
  }, [open, mode, videoId, videos]);

  const selectedList = useMemo(
    () => nonWatchers.filter((n: any) => selected[n.user_id] && n.phone),
    [nonWatchers, selected],
  );

  const toggleAll = (checked: boolean) => {
    const next: Record<string, boolean> = {};
    nonWatchers.forEach((n: any) => {
      if (n.phone) next[n.user_id] = checked;
    });
    setSelected(next);
  };

  const withPhoneCount = nonWatchers.filter((n: any) => n.phone).length;
  const withoutPhoneCount = nonWatchers.length - withPhoneCount;

  const submit = async () => {
    if (!message.trim()) return toast.error("메시지를 입력하세요.");
    if (selectedList.length === 0) return toast.error("수신자를 선택하세요.");

    setSending(true);
    try {
      const recipients = selectedList.map((n: any) => ({
        user_id: n.user_id,
        name: n.name,
        phone: n.phone,
        branch: n.branch,
      }));
      const res =
        channel === "sms"
          ? await sendClassSms({ data: { classId, recipients, message: message.trim() } })
          : await sendClassBrandTalk({
              data: {
                classId,
                recipients,
                message: message.trim(),
                fallbackToSms: true,
              },
            });
      const okBranches = res.groups.filter((g: any) => g.ok);
      const failBranches = res.groups.filter((g: any) => !g.ok);
      const okCount = okBranches.reduce((n: number, g: any) => n + g.count, 0);
      if (okCount > 0) toast.success(`${okCount}명에게 발송되었습니다.`);
      if (failBranches.length > 0) {
        toast.error(
          `실패: ${failBranches.map((g: any) => `${g.branch}(${g.error ?? "오류"})`).join(", ")}`,
        );
      }
      if (failBranches.length === 0) onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message ?? "전송 중 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> 미시청 학생에게 문자 전송
          </DialogTitle>
          <DialogDescription>
            학생의 교육원(상동·청라·송도)에 따라 각 교육원 계정으로 자동 발송됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">미시청 기준</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "video" | "class")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="video" id="mode-video" />
                <Label htmlFor="mode-video" className="cursor-pointer text-sm">
                  특정 영상
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="class" id="mode-class" />
                <Label htmlFor="mode-class" className="cursor-pointer text-sm">
                  수강반 전체 진도
                </Label>
              </div>
            </RadioGroup>
          </div>

          {mode === "video" && (
            <div className="space-y-2">
              <Label className="text-sm">영상 선택</Label>
              <Select value={videoId} onValueChange={setVideoId}>
                <SelectTrigger>
                  <SelectValue placeholder="영상을 선택하세요" />
                </SelectTrigger>
                <SelectContent>
                  {videos.map((v: any) => (
                    <SelectItem key={v.id} value={v.id}>
                      {v.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm">
                {mode === "video" ? "이 영상을 완료하지 않은 학생" : "진도 미완료 학생"}{" "}
                ({withPhoneCount}명 발송 가능
                {withoutPhoneCount > 0 ? ` · ${withoutPhoneCount}명 번호 없음` : ""})
              </Label>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => toggleAll(true)}
                  disabled={isFetching || withPhoneCount === 0}
                >
                  전체 선택
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => toggleAll(false)}
                  disabled={isFetching}
                >
                  해제
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => refetch()}
                  disabled={isFetching}
                >
                  {isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "새로고침"}
                </Button>
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border">
              {isFetching ? (
                <div className="flex items-center justify-center p-6 text-sm text-muted-foreground">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 조회 중...
                </div>
              ) : nonWatchers.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  미시청 학생이 없습니다.
                </p>
              ) : (
                <ul className="divide-y">
                  {nonWatchers.map((n: any) => (
                    <li key={n.user_id} className="flex items-center gap-3 px-3 py-2">
                      <Checkbox
                        checked={!!selected[n.user_id]}
                        disabled={!n.phone}
                        onCheckedChange={(v) =>
                          setSelected((s) => ({ ...s, [n.user_id]: !!v }))
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">
                          {n.name || "(이름 없음)"}
                          {n.branch && (
                            <span className="ml-2 text-xs text-muted-foreground">[{n.branch}]</span>
                          )}
                          {n.phone_source === "parent" && (
                            <span className="ml-1 text-xs text-amber-600">(학부모)</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {n.phone || "전화번호 없음"} · 미완료 {n.incomplete_count}/{n.eligible_total}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-sm">채널</Label>
            <RadioGroup
              value={channel}
              onValueChange={(v) => setChannel(v as "sms" | "brandtalk")}
              className="flex gap-4"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="sms" id="ch-sms" />
                <Label htmlFor="ch-sms" className="cursor-pointer text-sm">
                  SMS/LMS
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="brandtalk" id="ch-bt" />
                <Label htmlFor="ch-bt" className="cursor-pointer text-sm">
                  카카오 브랜드톡
                </Label>
              </div>
            </RadioGroup>
          </div>


          <div className="space-y-2">
            <Label htmlFor="msg" className="text-sm">
              메시지 ({message.length}자)
            </Label>
            <Textarea
              id="msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="예) [OO학원] 이번 주 수업 영상이 아직 시청되지 않았어요. 오늘 안에 시청 부탁드립니다."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={sending}>
            취소
          </Button>
          <Button onClick={submit} disabled={sending || selectedList.length === 0}>
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 전송 중...
              </>
            ) : (
              `${selectedList.length}명에게 전송`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
