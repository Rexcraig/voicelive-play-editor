// Logs VoiceSupport's CoreMIDI traffic. Load with DYLD_INSERT_LIBRARIES; affects only that process.
#include <CoreMIDI/CoreMIDI.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/time.h>

static FILE *out_file;

static void dump(const char *dir, const MIDIPacketList *pl) {
    if (!out_file) {
        const char *path = getenv("MIDILOG_PATH");
        out_file = fopen(path ? path : "/tmp/midilog.txt", "a");
        if (!out_file) return;
    }
    struct timeval tv; gettimeofday(&tv, NULL);
    const MIDIPacket *p = &pl->packet[0];
    for (UInt32 i = 0; i < pl->numPackets; i++) {
        fprintf(out_file, "%ld.%03d %s", (long)tv.tv_sec, (int)(tv.tv_usec / 1000), dir);
        for (UInt16 j = 0; j < p->length; j++) fprintf(out_file, " %02X", p->data[j]);
        fputc('\n', out_file);
        p = MIDIPacketNext(p);
    }
    fflush(out_file);
}

typedef struct { MIDIReadProc proc; void *refCon; } Wrap;

static void wrapped_read(const MIDIPacketList *pl, void *portRef, void *srcRef) {
    Wrap *w = portRef;
    dump("IN ", pl);
    w->proc(pl, w->refCon, srcRef);
}

static OSStatus my_MIDISend(MIDIPortRef port, MIDIEndpointRef dest, const MIDIPacketList *pl) {
    dump("OUT", pl);
    return MIDISend(port, dest, pl);
}

static OSStatus my_MIDIInputPortCreate(MIDIClientRef client, CFStringRef name, MIDIReadProc proc, void *refCon, MIDIPortRef *out) {
    Wrap *w = malloc(sizeof *w);
    w->proc = proc; w->refCon = refCon;
    return MIDIInputPortCreate(client, name, wrapped_read, w, out);
}

__attribute__((used)) static const struct { void *repl; void *orig; } interposers[] __attribute__((section("__DATA,__interpose"))) = {
    { my_MIDISend, MIDISend },
    { my_MIDIInputPortCreate, MIDIInputPortCreate },
};
