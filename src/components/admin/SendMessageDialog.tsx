import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, MessageSquare, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { listClassStudentsForMessaging, sendClassSms, sendClassBrandTalk } from "@/lib/sms.functions";
import { listClassVideos, getClass, listClassFolders } from "@/lib/classes.functions";
import { getMyStatus } from "@/lib/vimeo.functions";
import { canonicalBranch } from "@/lib/branch";

import { BranchBadge } from "@/components/BranchBadge";
import { cn } from "@/lib/utils";


type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  classId: string;
  className?: string;
};


type SelectionKey = string; // `${user_id}:self` | `${user_id}:parent`

type StudentStatus = "all" | "completed" | "incomplete";

export function SendMessageDialog({ open, onOpenChange, classId, className }: Props) {
  const [mode, setMode] = useState<"video" | "class">("video");
  const [videoIds, setVideoIds] = useState<string[]>([]);
  const [requiredOnly, setRequiredOnly] = useState(true);
  const [channel, setChannel] = useState<"sms" | "brandtalk">("brandtalk");
  const [message, setMessage] = useState("");
  const [statusFilter, setStatusFilter] = useState<StudentStatus>("incomplete");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const branchInitRef = useRef(false);


  const [selected, setSelected] = useState<Record<SelectionKey, boolean>>({});
  const [sending, setSending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const queryClient = useQueryClient();


  const { data: videos = [] } = useQuery({
    queryKey: ["admin", "class", classId, "videos-lite"],
    queryFn: () => listClassVideos({ data: { classId } }),
    enabled: open,
  });

  const { data: folders = [] } = useQuery({
    queryKey: ["admin", "class", classId, "folders-lite"],
    queryFn: () => listClassFolders({ data: { classId } }),
    enabled: open,
  });

  const folderMap = useMemo(() => {
    const m = new Map<string, any>();
    (folders as any[]).forEach((f) => m.set(f.id, f));
    return m;
  }, [folders]);

  const isRequiredVideo = (v: any) => {
    if (!v?.folder_id) return false;
    return !!folderMap.get(v.folder_id)?.is_required;
  };

  const effectiveVideoIds = mode === "video" ? videoIds : [];

  const { data: classData } = useQuery({
    queryKey: ["admin", "class", classId, "name"],
    queryFn: () => getClass({ data: { id: classId } }),
    enabled: open && !className,
  });
  const resolvedClassName = className ?? (classData as any)?.name ?? "";

  const selectedVideos = useMemo(
    () => (videos as any[]).filter((v) => videoIds.includes(v.id)),
    [videos, videoIds],
  );
  const videoTitle = selectedVideos.map((v) => v.title).join(", ");


  const {
    data: studentsData,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: [
      "class-students-messaging",
      classId,
      effectiveVideoIds.length > 0 ? [...effectiveVideoIds].sort().join(",") : "__all__",
      mode === "class" ? requiredOnly : false,
    ],
    queryFn: () =>
      listClassStudentsForMessaging({
        data: {
          classId,
          ...(effectiveVideoIds.length > 0 ? { videoIds: effectiveVideoIds } : {}),
          ...(mode === "class" ? { requiredOnly } : {}),
        },
      }),
    enabled: open && (mode === "class" || videoIds.length > 0),
  });

  const allStudents = studentsData ?? [];

  const { data: myStatus } = useQuery({
    queryKey: ["my-status-messaging"],
    queryFn: () => getMyStatus(),
    enabled: open,
    retry: false,
  });
  const myBranch = canonicalBranch((myStatus as any)?.branch ?? "");

  const branchOptions = useMemo(() => {
    const set = new Set<string>();
    allStudents.forEach((s: any) => {
      const b = canonicalBranch(s.branch);
      if (b) set.add(b);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "ko"));
  }, [allStudents]);

  // 로그인한 강사의 교육원을 기본 선택
  useEffect(() => {
    if (!open) {
      branchInitRef.current = false;
      return;
    }
    if (branchInitRef.current || branchOptions.length === 0) return;
    if (myBranch && branchOptions.includes(myBranch)) setBranchFilter(myBranch);
    branchInitRef.current = true;
  }, [open, myBranch, branchOptions]);

  const students = useMemo(() => {
    if (branchFilter === "all") return allStudents;
    return allStudents.filter((s: any) => canonicalBranch(s.branch) === branchFilter);
  }, [allStudents, branchFilter]);

  const filteredStudents = useMemo(() => {
    if (statusFilter === "all") return students;
    return students.filter((s: any) => s.status === statusFilter);
  }, [students, statusFilter]);

  useEffect(() => {
    setSelected({});
  }, [branchFilter]);

  useEffect(() => {

    if (!open || !studentsData) return;
    // 기본값: 전체 체크 해제
    setSelected({});
  }, [open, studentsData]);

  useEffect(() => {
    if (open && mode === "video" && videoIds.length === 0 && videos.length > 0) {
      setVideoIds([(videos[0] as any).id]);
    }
  }, [open, mode, videoIds, videos]);

  const toggleVideo = (id: string, checked: boolean) => {
    setVideoIds((prev) => (checked ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));
  };

  type Recipient = { user_id: string; name: string; phone: string; branch: string };

  const selectedList: Recipient[] = useMemo(() => {
    const out: Recipient[] = [];
    students.forEach((n: any) => {
      if (n.student_phone && selected[`${n.user_id}:self`]) {
        out.push({ user_id: n.user_id, name: n.name, phone: n.student_phone, branch: n.branch });
      }
      if (n.parent_phone && selected[`${n.user_id}:parent`]) {
        out.push({ user_id: n.user_id, name: n.name, phone: n.parent_phone, branch: n.branch });
      }
    });
    return out;
  }, [students, selected]);

  const toggleAll = (target: "self" | "parent", checked: boolean) => {
    setSelected((prev) => {
      const next = { ...prev };
      filteredStudents.forEach((n: any) => {
        const phone = target === "self" ? n.student_phone : n.parent_phone;
        if (phone) next[`${n.user_id}:${target}`] = checked;
      });
      return next;
    });
  };

  const clearAll = () => setSelected({});

  const insertVariable = (variable: string) => {
    const el = textareaRef.current;
    if (!el) {
      setMessage((prev) => prev + variable);
      return;
    }
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const next = message.slice(0, start) + variable + message.slice(end);
    setMessage(next);
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + variable.length;
      el.setSelectionRange(pos, pos);
    });
  };

  const previewMessage = useMemo(() => {
    return message
      .replace(/\{수강반명\}/g, resolvedClassName)
      .replace(/\{영상명\}/g, videoTitle);
  }, [message, resolvedClassName, videoTitle]);

  const selfAvailable = filteredStudents.filter((n: any) => n.student_phone).length;

  const parentAvailable = filteredStudents.filter((n: any) => n.parent_phone).length;
  const noPhoneCount = filteredStudents.filter((n: any) => !n.student_phone && !n.parent_phone).length;

  const completedCount = students.filter((s: any) => s.status === "completed").length;
  const incompleteCount = students.filter((s: any) => s.status === "incomplete").length;

  const submit = () => {
    if (!message.trim()) return toast.error("메시지를 입력하세요.");
    if (selectedList.length === 0) return toast.error("수신자를 선택하세요.");
    setConfirmOpen(true);
  };

  const doSend = async () => {
    setSending(true);
    try {
      const res =
        channel === "sms"
          ? await sendClassSms({ data: { classId, videoId: effectiveVideoIds[0], recipients: selectedList, message: message.trim() } })
          : await sendClassBrandTalk({
              data: {
                classId,
                videoId: effectiveVideoIds[0],
                recipients: selectedList,
                message: message.trim(),
                fallbackToSms: true,
              },
            });

      queryClient.invalidateQueries({ queryKey: ["class-sms-logs", classId] });
      const okBranches = res.groups.filter((g: any) => g.ok);
      const failBranches = res.groups.filter((g: any) => !g.ok);
      const okCount = okBranches.reduce((n: number, g: any) => n + g.count, 0);
      if (okCount > 0) toast.success(`${okCount}건 발송되었습니다.`);
      if (failBranches.length > 0) {
        toast.error(
          `실패: ${failBranches.map((g: any) => `${g.branch}(${g.error ?? "오류"})`).join(", ")}`,
        );
      }
      setConfirmOpen(false);
      if (failBranches.length === 0) onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message ?? "전송 중 오류가 발생했습니다.");
    } finally {
      setSending(false);
    }
  };

  const statusLabel =
    statusFilter === "completed"
      ? "완료한 학생"
      : statusFilter === "incomplete"
        ? "미완료 학생"
        : "전체 학생";

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> 학생에게 문자 전송
          </DialogTitle>
          <DialogDescription>
            학생의 교육원(상동·청라·송도)에 따라 각 교육원 계정으로 자동 발송됩니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-sm">시청 기준</Label>
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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label className="text-sm">영상 선택 (여러 개 선택 가능 · {videoIds.length}개)</Label>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      setVideoIds((videos as any[]).filter(isRequiredVideo).map((v) => v.id))
                    }
                  >
                    필수 영상 전체
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setVideoIds((videos as any[]).map((v) => v.id))}
                  >
                    전체 선택
                  </Button>
                  <Button type="button" size="sm" variant="ghost" onClick={() => setVideoIds([])}>
                    선택 해제
                  </Button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border">
                {videos.length === 0 ? (
                  <p className="p-4 text-center text-sm text-muted-foreground">영상이 없습니다.</p>
                ) : (
                  <ul className="divide-y">
                    {(videos as any[]).map((v) => {
                      const required = isRequiredVideo(v);
                      return (
                        <li key={v.id}>
                          <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm">
                            <Checkbox
                              checked={videoIds.includes(v.id)}
                              onCheckedChange={(c) => toggleVideo(v.id, !!c)}
                            />
                            <span className="truncate">{v.title}</span>
                            <span
                              className={cn(
                                "shrink-0 rounded px-1.5 py-0.5 text-xs",
                                required
                                  ? "bg-primary/10 text-primary"
                                  : "bg-muted text-muted-foreground",
                              )}
                            >
                              {required ? "필수" : "선택"}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          )}

          {mode === "class" && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox
                checked={requiredOnly}
                onCheckedChange={(c) => setRequiredOnly(!!c)}
              />
              <span>필수 폴더 영상만 진도 계산에 포함</span>
            </label>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm">수신 대상</Label>
              <div className="flex flex-wrap items-center gap-2">
                {branchOptions.length > 0 && (
                  <Select value={branchFilter} onValueChange={setBranchFilter} disabled={isFetching}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="교육원 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">교육원 전체</SelectItem>
                      {branchOptions.map((b) => (
                        <SelectItem key={b} value={b}>
                          {b}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {(["all", "incomplete", "completed"] as StudentStatus[]).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    size="sm"
                    variant={statusFilter === s ? "default" : "outline"}
                    onClick={() => setStatusFilter(s)}
                    disabled={isFetching}
                  >
                    {s === "all" ? "전체" : s === "completed" ? "완료" : "미완료"}
                  </Button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm">
                {mode === "video" ? "이 영상을 " : "수강반 진도 "}
                {statusLabel} ({students.length}명: 완료 {completedCount} · 미완료 {incompleteCount})
              </Label>
              <div className="flex flex-wrap gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => toggleAll("self", true)}
                  disabled={isFetching || selfAvailable === 0}
                >
                  본인 전체
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => toggleAll("parent", true)}
                  disabled={isFetching || parentAvailable === 0}
                >
                  학부모 전체
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={clearAll}
                  disabled={isFetching}
                >
                  전체 해제
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
              ) : filteredStudents.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">
                  {statusFilter === "completed"
                    ? "완료한 학생이 없습니다."
                    : statusFilter === "incomplete"
                      ? "미완료 학생이 없습니다."
                      : "배정된 학생이 없습니다."}
                </p>
              ) : (
                <ul className="divide-y">
                  {filteredStudents.map((n: any) => {
                    const selfKey = `${n.user_id}:self`;
                    const parentKey = `${n.user_id}:parent`;
                    return (
                      <li key={n.user_id} className="flex flex-col gap-1 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                            <span className="truncate">{n.name || "(이름 없음)"}</span>
                            <BranchBadge branch={n.branch} />
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-xs font-normal",
                                n.status === "completed"
                                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300"
                                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
                              )}
                            >
                              {n.status === "completed" ? "완료" : "미완료"} {n.completed_count}/{n.eligible_total}
                            </span>
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 pl-1">
                          <label
                            className={`flex items-center gap-2 text-xs ${
                              n.student_phone ? "cursor-pointer" : "cursor-not-allowed opacity-40"
                            }`}
                          >
                            <Checkbox
                              checked={!!selected[selfKey]}
                              disabled={!n.student_phone}
                              onCheckedChange={(v) =>
                                setSelected((s) => ({ ...s, [selfKey]: !!v }))
                              }
                            />
                            <span className="text-muted-foreground">본인</span>
                            <span className="font-mono">
                              {n.student_phone || "번호 없음"}
                            </span>
                          </label>
                          <label
                            className={`flex items-center gap-2 text-xs ${
                              n.parent_phone ? "cursor-pointer" : "cursor-not-allowed opacity-40"
                            }`}
                          >
                            <Checkbox
                              checked={!!selected[parentKey]}
                              disabled={!n.parent_phone}
                              onCheckedChange={(v) =>
                                setSelected((s) => ({ ...s, [parentKey]: !!v }))
                              }
                            />
                            <span className="text-amber-600">학부모</span>
                            <span className="font-mono">
                              {n.parent_phone || "번호 없음"}
                            </span>
                          </label>
                        </div>
                      </li>
                    );
                  })}
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
                <RadioGroupItem value="brandtalk" id="ch-bt" />
                <Label htmlFor="ch-bt" className="cursor-pointer text-sm">
                  카카오 브랜드톡
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="sms" id="ch-sms" />
                <Label htmlFor="ch-sms" className="cursor-pointer text-sm">
                  SMS/LMS
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="msg" className="text-sm">
                메시지 ({message.length}자)
              </Label>
              <span className="text-xs text-muted-foreground">사용 가능한 변수</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => insertVariable("{수강반명}")}
              >
                {"{수강반명}"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => insertVariable("{영상명}")}
                disabled={mode !== "video" || videoIds.length === 0}
              >
                {"{영상명}"}
              </Button>
            </div>
            <Textarea
              ref={textareaRef}
              id="msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={5}
              placeholder="예) [{수강반명}] {영상명} 영상이 아직 시청되지 않았어요. 오늘 안에 시청 부탁드립니다."
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
              `${selectedList.length}건 전송`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5 text-amber-500" />
            문자를 전송할까요?
          </DialogTitle>
          <DialogDescription>
            {channel === "sms" ? "SMS/LMS" : "카카오 브랜드톡"} 채널로 총{" "}
            <strong>{selectedList.length}건</strong>을 발송합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <p className="mb-1 font-medium text-foreground">메시지 내용</p>
            <p className="whitespace-pre-wrap text-muted-foreground">{previewMessage.trim()}</p>
            {(message.includes("{수강반명}") || message.includes("{영상명}")) && (
              <p className="mt-2 text-xs text-muted-foreground">
                {"{수강반명}"}과 {"{영상명}"} 변수는 실제 발송 시 자동으로 치환됩니다.
              </p>
            )}
          </div>


          <div className="space-y-2">
            <Label className="text-sm">수신자 목록 ({selectedList.length}명)</Label>
            <ScrollArea className="h-48 rounded-md border">
              <ul className="divide-y">
                {selectedList.map((r, idx) => (
                  <li key={`${r.user_id}-${r.phone}-${idx}`} className="flex items-center justify-between px-3 py-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    <div className="flex items-center gap-2">
                      <BranchBadge branch={r.branch} />
                      <span className="font-mono text-xs text-muted-foreground">{r.phone}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={sending}>
            취소
          </Button>
          <Button onClick={doSend} disabled={sending}>
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> 전송 중...
              </>
            ) : (
              `${selectedList.length}건 전송`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
