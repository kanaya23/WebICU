import json
import os
import sys
from collections import Counter
from datetime import datetime

file1 = r"C:\Users\LOLBIT\Downloads\shopee.co.id.har_onpageload.txt"
file2 = r"C:\Users\LOLBIT\Downloads\Jual 2.4 TFT LCD Touchscreen spi serial Ili9341 240x320 pixel Arduino _ Shopee Indonesia.har"

def load_har(path):
    print(f"Loading {os.path.basename(path)} ({os.path.getsize(path):,} bytes)...")
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return json.load(f)

h1 = load_har(file1)
h2 = load_har(file2)

log1 = h1.get("log", {})
log2 = h2.get("log", {})

entries1 = log1.get("entries", [])
entries2 = log2.get("entries", [])

def get_stats(log, entries, label):
    stats = {}
    stats["label"] = label
    stats["creator"] = log.get("creator", {})
    stats["version"] = log.get("version", "unknown")
    pages = log.get("pages", [])
    stats["pages_count"] = len(pages)
    stats["pages"] = [
        {
            "id": p.get("id"),
            "started": p.get("startedDateTime"),
            "title": p.get("title", "")[:70] + "..." if len(p.get("title", "")) > 70 else p.get("title", ""),
            "timings": p.get("pageTimings", {})
        }
        for p in pages
    ]
    stats["total_entries"] = len(entries)
    
    if entries:
        dates = [e.get("startedDateTime", "") for e in entries if e.get("startedDateTime")]
        dates.sort()
        stats["first_entry"] = dates[0] if dates else None
        stats["last_entry"] = dates[-1] if dates else None
    
    # Method counts
    stats["methods"] = Counter(e.get("request", {}).get("method", "UNKNOWN") for e in entries)
    
    # Status codes
    stats["statuses"] = Counter(e.get("response", {}).get("status", "UNKNOWN") for e in entries)
    
    # HTTP versions
    stats["req_http_versions"] = Counter(e.get("request", {}).get("httpVersion", "UNKNOWN") for e in entries)
    stats["res_http_versions"] = Counter(e.get("response", {}).get("httpVersion", "UNKNOWN") for e in entries)
    
    # MIME types
    def clean_mime(m):
        if not m: return "none/unknown"
        return m.split(";")[0].strip().lower()
    
    stats["mimes"] = Counter(clean_mime(e.get("response", {}).get("content", {}).get("mimeType")) for e in entries)
    
    # Body stats
    bodies = [e for e in entries if e.get("response", {}).get("content", {}).get("text")]
    stats["entries_with_body"] = len(bodies)
    stats["body_coverage_pct"] = round(100.0 * len(bodies) / len(entries), 1) if entries else 0
    stats["total_body_chars"] = sum(len(e["response"]["content"]["text"]) for e in bodies)
    stats["base64_encoded_bodies"] = sum(1 for e in bodies if e["response"]["content"].get("encoding") == "base64")
    
    # Body breakdown by mime
    stats["bodies_by_mime"] = Counter(clean_mime(e.get("response", {}).get("content", {}).get("mimeType")) for e in bodies)
    
    # PostData stats
    post_entries = [e for e in entries if e.get("request", {}).get("method") in ("POST", "PUT", "PATCH")]
    post_with_data = [e for e in post_entries if e.get("request", {}).get("postData", {}).get("text")]
    stats["post_requests_total"] = len(post_entries)
    stats["post_with_payload"] = len(post_with_data)
    
    # Headers count
    req_header_lens = [len(e.get("request", {}).get("headers", [])) for e in entries]
    res_header_lens = [len(e.get("response", {}).get("headers", [])) for e in entries]
    stats["avg_req_headers"] = round(sum(req_header_lens) / len(req_header_lens), 1) if req_header_lens else 0
    stats["avg_res_headers"] = round(sum(res_header_lens) / len(res_header_lens), 1) if res_header_lens else 0
    
    # Timings breakdown
    has_full_timings = [
        e for e in entries 
        if e.get("timings") and all(k in e["timings"] for k in ("blocked", "dns", "connect", "send", "wait", "receive"))
    ]
    stats["entries_with_full_timings"] = len(has_full_timings)
    
    # Server IP & Connection
    stats["with_server_ip"] = sum(1 for e in entries if e.get("serverIPAddress"))
    stats["with_connection"] = sum(1 for e in entries if e.get("connection"))
    
    # Custom/CDP fields
    stats["with_initiator"] = sum(1 for e in entries if e.get("_initiator"))
    stats["with_resource_type"] = sum(1 for e in entries if e.get("_resourceType"))
    stats["with_transfer_size"] = sum(1 for e in entries if e.get("response", {}).get("_transferSize") is not None)
    
    return stats

s1 = get_stats(log1, entries1, "DevTools Export (.txt)")
s2 = get_stats(log2, entries2, "Extension Native CDP (.har)")

print("\n" + "=" * 80)
print("                       HAR FIDELITY COMPARISON REPORT")
print("=" * 80)

print(f"\n1. FILE & SESSION METRICS")
print(f"{'Metric':<32} | {'DevTools Export (.txt)':<26} | {'Extension Export (.har)':<26}")
print("-" * 88)
print(f"{'File Size on Disk':<32} | {os.path.getsize(file1):>20,} bytes | {os.path.getsize(file2):>20,} bytes")
print(f"{'Creator Tool':<32} | {str(s1['creator'].get('name')) + ' v' + str(s1['creator'].get('version')):<26} | {str(s2['creator'].get('name')):<26}")
print(f"{'HAR Specification Version':<32} | {s1['version']:<26} | {s2['version']:<26}")
print(f"{'Recorded Pages (Tabs/Navs)':<32} | {s1['pages_count']:<26} | {s2['pages_count']:<26}")
print(f"{'Total Recorded Entries':<32} | {s1['total_entries']:<26} | {s2['total_entries']:<26}")
print(f"{'First Entry Timestamp':<32} | {str(s1.get('first_entry')):<26} | {str(s2.get('first_entry')):<26}")
print(f"{'Last Entry Timestamp':<32} | {str(s1.get('last_entry')):<26} | {str(s2.get('last_entry')):<26}")

print(f"\n2. PROTOCOL & HTTP VERSION FIDELITY")
print(f"{'Metric':<32} | {'DevTools Export (.txt)':<26} | {'Extension Export (.har)':<26}")
print("-" * 88)
print(f"{'Request Methods':<32} | {dict(s1['methods'])!s:<26} | {dict(s2['methods'])!s:<26}")
print(f"{'Response Status Codes':<32} | {dict(s1['statuses'])!s:<26} | {dict(s2['statuses'])!s:<26}")
print(f"{'Request HTTP Versions':<32} | {dict(s1['req_http_versions'])!s:<26} | {dict(s2['req_http_versions'])!s:<26}")
print(f"{'Response HTTP Versions':<32} | {dict(s1['res_http_versions'])!s:<26} | {dict(s2['res_http_versions'])!s:<26}")

print(f"\n3. PAYLOAD & RESPONSE BODY FIDELITY")
print(f"{'Metric':<32} | {'DevTools Export (.txt)':<26} | {'Extension Export (.har)':<26}")
print("-" * 88)
print(f"{'Entries with Response Body':<32} | {s1['entries_with_body']:>4} ({s1['body_coverage_pct']}%)            | {s2['entries_with_body']:>4} ({s2['body_coverage_pct']}%)")
print(f"{'Base64 Encoded (Binary)':<32} | {s1['base64_encoded_bodies']:>20,} entries | {s2['base64_encoded_bodies']:>20,} entries")
print(f"{'Total Response Body Size':<32} | {s1['total_body_chars']:>20,} chars   | {s2['total_body_chars']:>20,} chars")
print(f"{'POST Requests with Payload':<32} | {s1['post_with_payload']}/{s1['post_requests_total']} ({round(100*s1['post_with_payload']/s1['post_requests_total'] if s1['post_requests_total'] else 0)}%)                 | {s2['post_with_payload']}/{s2['post_requests_total']} ({round(100*s2['post_with_payload']/s2['post_requests_total'] if s2['post_requests_total'] else 0)}%)")

print(f"\nResponse Body Capture by MIME type:")
all_mimes = set(s1['bodies_by_mime'].keys()) | set(s2['bodies_by_mime'].keys())
for m in sorted(all_mimes):
    c1 = s1['bodies_by_mime'].get(m, 0)
    c2 = s2['bodies_by_mime'].get(m, 0)
    print(f"  - {m:<30} DevTools: {c1:>4} entries | Extension: {c2:>4} entries")

print(f"\n4. METADATA & TIMING BREAKDOWN FIDELITY")
print(f"{'Metric':<32} | {'DevTools Export (.txt)':<26} | {'Extension Export (.har)':<26}")
print("-" * 88)
print(f"{'Average Request Headers':<32} | {s1['avg_req_headers']:<26} | {s2['avg_req_headers']:<26}")
print(f"{'Average Response Headers':<32} | {s1['avg_res_headers']:<26} | {s2['avg_res_headers']:<26}")
print(f"{'Full 7-phase Timing Breakdown':<32} | {s1['entries_with_full_timings']:>4} ({round(100*s1['entries_with_full_timings']/s1['total_entries'] if s1['total_entries'] else 0)}%)                 | {s2['entries_with_full_timings']:>4} ({round(100*s2['entries_with_full_timings']/s2['total_entries'] if s2['total_entries'] else 0)}%)")
print(f"{'Server IP Address Populated':<32} | {s1['with_server_ip']:>4} ({round(100*s1['with_server_ip']/s1['total_entries'] if s1['total_entries'] else 0)}%)                 | {s2['with_server_ip']:>4} ({round(100*s2['with_server_ip']/s2['total_entries'] if s2['total_entries'] else 0)}%)")
print(f"{'Connection ID Populated':<32} | {s1['with_connection']:>4} ({round(100*s1['with_connection']/s1['total_entries'] if s1['total_entries'] else 0)}%)                 | {s2['with_connection']:>4} ({round(100*s2['with_connection']/s2['total_entries'] if s2['total_entries'] else 0)}%)")
print(f"{'Initiator Metadata Populated':<32} | {s1['with_initiator']:>4} ({round(100*s1['with_initiator']/s1['total_entries'] if s1['total_entries'] else 0)}%)                 | {s2['with_initiator']:>4} ({round(100*s2['with_initiator']/s2['total_entries'] if s2['total_entries'] else 0)}%)")
print(f"{'Resource Type Metadata':<32} | {s1['with_resource_type']:>4} ({round(100*s1['with_resource_type']/s1['total_entries'] if s1['total_entries'] else 0)}%)                 | {s2['with_resource_type']:>4} ({round(100*s2['with_resource_type']/s2['total_entries'] if s2['total_entries'] else 0)}%)")
print(f"{'_transferSize Populated':<32} | {s1['with_transfer_size']:>4} ({round(100*s1['with_transfer_size']/s1['total_entries'] if s1['total_entries'] else 0)}%)                 | {s2['with_transfer_size']:>4} ({round(100*s2['with_transfer_size']/s2['total_entries'] if s2['total_entries'] else 0)}%)")

print("\n" + "=" * 80)
