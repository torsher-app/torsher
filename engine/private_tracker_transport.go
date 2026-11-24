package main

import (
	"bytes"
	"context"
	"crypto/tls"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/anacrolix/dht/v2/krpc"
	"github.com/anacrolix/torrent/bencode"
	"github.com/anacrolix/torrent/tracker"
	"github.com/anacrolix/torrent/tracker/udp"
	"github.com/anacrolix/torrent/version"
)

type trackerErrorCode string

const (
	trackerInvalidURL      trackerErrorCode = "invalid_url"
	trackerNetworkError    trackerErrorCode = "network_error"
	trackerTimeout         trackerErrorCode = "timeout"
	trackerTLSFailure      trackerErrorCode = "tls_failed"
	trackerRedirect        trackerErrorCode = "redirect"
	trackerHTTPStatus      trackerErrorCode = "http_status"
	trackerInvalidResponse trackerErrorCode = "invalid_response"
	trackerRejected        trackerErrorCode = "rejected"
)

const (
	maxPrivateTrackerResponse = 1 << 20
	maxUDPTrackerURI          = 4096
)

// The endpoint contains credentials. Only error codes leave the transport.
type privateAnnouncer struct {
	endpoint *url.URL
	dial     func(context.Context, string, string) (net.Conn, error)
	http     *http.Client
}

func newPrivateAnnouncer(endpoint string, dial func(context.Context, string, string) (net.Conn, error)) (*privateAnnouncer, trackerErrorCode) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Hostname() == "" || u.Fragment != "" {
		return nil, trackerInvalidURL
	}
	if dial == nil {
		dial = (&net.Dialer{}).DialContext
	}
	a := &privateAnnouncer{endpoint: u, dial: dial}
	switch u.Scheme {
	case "http", "https":
		query, err := url.ParseQuery(u.RawQuery)
		if err != nil {
			return nil, trackerInvalidURL
		}
		for name := range query {
			switch strings.ToLower(name) {
			case "info_hash", "peer_id", "port", "uploaded", "downloaded", "left", "numwant", "compact", "supportcrypto", "event", "key":
				// A tracker can read the first value of a duplicate field.
				return nil, trackerInvalidURL
			}
		}
		a.http = &http.Client{
			Transport: &http.Transport{DialContext: dial},
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	case "udp", "udp4", "udp6":
		port, err := strconv.ParseUint(u.Port(), 10, 16)
		if err != nil || port == 0 || u.User != nil || len(u.RequestURI()) > maxUDPTrackerURI {
			return nil, trackerInvalidURL
		}
	default:
		return nil, trackerInvalidURL
	}
	return a, ""
}

func (a *privateAnnouncer) close() {
	if a.http != nil {
		a.http.CloseIdleConnections()
	}
}

func (a *privateAnnouncer) announce(ctx context.Context, req tracker.AnnounceRequest) (tracker.AnnounceResponse, trackerErrorCode) {
	ctx, cancel := context.WithTimeout(ctx, tracker.DefaultTrackerAnnounceTimeout)
	defer cancel()
	if a.http != nil {
		return a.announceHTTP(ctx, req)
	}
	return a.announceUDP(ctx, req)
}

func trackerNetworkCode(err error) trackerErrorCode {
	var certErr *tls.CertificateVerificationError
	var recordErr tls.RecordHeaderError
	var networkErr net.Error
	switch {
	case errors.Is(err, context.DeadlineExceeded), errors.As(err, &networkErr) && networkErr.Timeout():
		return trackerTimeout
	case errors.As(err, &certErr), errors.As(err, &recordErr):
		return trackerTLSFailure
	default:
		return trackerNetworkError
	}
}

func (a *privateAnnouncer) announceHTTP(ctx context.Context, req tracker.AnnounceRequest) (tracker.AnnounceResponse, trackerErrorCode) {
	u := *a.endpoint
	params := url.Values{
		"key":           {strconv.FormatInt(int64(req.Key), 10)},
		"info_hash":     {string(req.InfoHash[:])},
		"peer_id":       {string(req.PeerId[:])},
		"port":          {strconv.FormatUint(uint64(req.Port), 10)},
		"uploaded":      {strconv.FormatInt(req.Uploaded, 10)},
		"downloaded":    {strconv.FormatInt(req.Downloaded, 10)},
		"left":          {strconv.FormatInt(req.Left, 10)},
		"numwant":       {strconv.FormatInt(int64(req.NumWant), 10)},
		"compact":       {"1"},
		"supportcrypto": {"1"},
	}
	if req.Event != tracker.None {
		params.Set("event", req.Event.String())
	}
	// Keep the original path and query, including the order of credential fields.
	if u.RawQuery != "" {
		u.RawQuery += "&"
	}
	u.RawQuery += strings.ReplaceAll(params.Encode(), "+", "%20")
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return tracker.AnnounceResponse{}, trackerInvalidURL
	}
	request.Header.Set("User-Agent", version.DefaultHttpUserAgent)
	response, err := a.http.Do(request)
	if err != nil {
		return tracker.AnnounceResponse{}, trackerNetworkCode(err)
	}
	defer response.Body.Close()
	switch {
	case response.StatusCode >= 300 && response.StatusCode <= 399:
		return tracker.AnnounceResponse{}, trackerRedirect
	case response.StatusCode != http.StatusOK:
		return tracker.AnnounceResponse{}, trackerHTTPStatus
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, maxPrivateTrackerResponse+1))
	if err != nil {
		return tracker.AnnounceResponse{}, trackerNetworkCode(err)
	}
	if len(body) > maxPrivateTrackerResponse {
		return tracker.AnnounceResponse{}, trackerInvalidResponse
	}
	return decodePrivateHTTPResponse(body)
}

func decodePrivateHTTPResponse(body []byte) (tracker.AnnounceResponse, trackerErrorCode) {
	// The upstream non-compact parser type-asserts untrusted fields and can panic.
	var response struct {
		FailureReason string                    `bencode:"failure reason"`
		Interval      int32                     `bencode:"interval"`
		Complete      int32                     `bencode:"complete"`
		Incomplete    int32                     `bencode:"incomplete"`
		Peers         bencode.Bytes             `bencode:"peers"`
		Peers6        krpc.CompactIPv6NodeAddrs `bencode:"peers6"`
	}
	if err := bencode.Unmarshal(body, &response); err != nil {
		return tracker.AnnounceResponse{}, trackerInvalidResponse
	}
	if response.FailureReason != "" {
		return tracker.AnnounceResponse{}, trackerRejected
	}
	if response.Interval <= 0 {
		return tracker.AnnounceResponse{}, trackerInvalidResponse
	}
	out := tracker.AnnounceResponse{Interval: response.Interval, Seeders: response.Complete, Leechers: response.Incomplete}
	if len(response.Peers) != 0 && response.Peers[0] == 'l' {
		var peers []struct {
			IP   string `bencode:"ip"`
			Port int    `bencode:"port"`
		}
		if err := bencode.Unmarshal(response.Peers, &peers); err != nil {
			return tracker.AnnounceResponse{}, trackerInvalidResponse
		}
		for _, peer := range peers {
			if ip := net.ParseIP(peer.IP); ip != nil && peer.Port > 0 && peer.Port <= 65535 {
				out.Peers = append(out.Peers, tracker.Peer{IP: ip, Port: peer.Port})
			}
		}
	} else if len(response.Peers) != 0 {
		var peers krpc.CompactIPv4NodeAddrs
		if err := bencode.Unmarshal(response.Peers, &peers); err != nil {
			return tracker.AnnounceResponse{}, trackerInvalidResponse
		}
		for _, peer := range peers {
			out.Peers = append(out.Peers, tracker.Peer{}.FromNodeAddr(peer))
		}
	}
	for _, peer := range response.Peers6 {
		out.Peers = append(out.Peers, tracker.Peer{}.FromNodeAddr(peer))
	}
	return out, ""
}

func (a *privateAnnouncer) announceUDP(ctx context.Context, req tracker.AnnounceRequest) (tracker.AnnounceResponse, trackerErrorCode) {
	// A connected socket keeps reads and writes on the same selected endpoint.
	// The engine supplies its interface-bound dialer when binding is enabled.
	conn, err := a.dial(ctx, a.endpoint.Scheme, a.endpoint.Host)
	if err != nil {
		return tracker.AnnounceResponse{}, trackerNetworkCode(err)
	}
	defer conn.Close()
	deadline, _ := ctx.Deadline()
	if err := conn.SetDeadline(deadline); err != nil {
		return tracker.AnnounceResponse{}, trackerNetworkCode(err)
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	data := make([]byte, 65535)
	response, code := privateUDPExchange(conn, data, udp.ConnectRequestConnectionId, udp.ActionConnect, nil, nil)
	if code != "" {
		return tracker.AnnounceResponse{}, code
	}
	var connection udp.ConnectionResponse
	if err := udp.Read(response, &connection); err != nil {
		return tracker.AnnounceResponse{}, trackerInvalidResponse
	}
	response, code = privateUDPExchange(conn, data, connection.ConnectionId, udp.ActionAnnounce, &req, (udp.Options{RequestUri: a.endpoint.RequestURI()}).Encode())
	if code != "" {
		return tracker.AnnounceResponse{}, code
	}
	var result udp.AnnounceResponseHeader
	if err := udp.Read(response, &result); err != nil || result.Interval <= 0 {
		return tracker.AnnounceResponse{}, trackerInvalidResponse
	}
	peers := udp.AnnounceResponsePeers(&krpc.CompactIPv4NodeAddrs{})
	if remote, ok := conn.RemoteAddr().(*net.UDPAddr); ok && remote.IP.To4() == nil {
		peers = &krpc.CompactIPv6NodeAddrs{}
	}
	if err := peers.UnmarshalBinary(response.Bytes()); err != nil {
		return tracker.AnnounceResponse{}, trackerInvalidResponse
	}
	out := tracker.AnnounceResponse{Interval: result.Interval, Seeders: result.Seeders, Leechers: result.Leechers}
	for _, peer := range peers.NodeAddrs() {
		out.Peers = append(out.Peers, tracker.Peer{}.FromNodeAddr(peer))
	}
	return out, ""
}

func privateUDPExchange(conn net.Conn, data []byte, id udp.ConnectionId, action udp.Action, announce *tracker.AnnounceRequest, options []byte) (*bytes.Buffer, trackerErrorCode) {
	transaction := udp.RandomTransactionId()
	var packet bytes.Buffer
	if err := udp.Write(&packet, udp.RequestHeader{ConnectionId: id, Action: action, TransactionId: transaction}); err != nil {
		return nil, trackerNetworkError
	}
	if announce != nil {
		if err := udp.Write(&packet, announce); err != nil {
			return nil, trackerNetworkError
		}
		packet.Write(options)
	}
	if _, err := conn.Write(packet.Bytes()); err != nil {
		return nil, trackerNetworkCode(err)
	}
	for {
		n, err := conn.Read(data)
		if err != nil {
			return nil, trackerNetworkCode(err)
		}
		response := bytes.NewBuffer(data[:n])
		var header udp.ResponseHeader
		if err := udp.Read(response, &header); err != nil || header.TransactionId != transaction {
			continue
		}
		if header.Action == udp.ActionError {
			return nil, trackerRejected
		}
		if header.Action != action {
			return nil, trackerInvalidResponse
		}
		return response, ""
	}
}
