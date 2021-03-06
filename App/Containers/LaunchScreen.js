import React from "react";
import {
  ScrollView,
  Text,
  Image,
  View,
  TouchableHighlight,
  ListView,
  TextInput
} from "react-native";
import { Images } from "../Themes";
import {
  RTCPeerConnection,
  RTCIceCandidate,
  RTCSessionDescription,
  RTCView,
  MediaStream,
  MediaStreamTrack,
  getUserMedia
} from "react-native-webrtc";
import io from "socket.io-client";
const socket = io.connect("https://react-native-webrtc.herokuapp.com", {
  transports: ["websocket"]
});
const configuration = { iceServers: [{ url: "stun:stun.l.google.com:19302" }] };

const pcPeers = {};
let localStream;
let container;
// Styles
import styles from "./Styles/LaunchScreenStyles";

export default class LaunchScreen extends React.Component {
  constructor(props) {
    super(props);
    container = this;

    this.state = {
      info: "Initializing",
      status: "init",
      roomID: "",
      isFront: true,
      selfViewSrc: null,
      remoteList: {},
      textRoomConnected: false,
      textRoomData: [],
      textRoomValue: ''
    };

    this.ds = new ListView.DataSource({ rowHasChanged: (r1, r2) => true });
  }

  getLocalStream(isFront, callback) {
    MediaStreamTrack.getSources(sourceInfos => {
      let videoSourceId;
      for (const i = 0; i < sourceInfos.length; i++) {
        const sourceInfo = sourceInfos[i];
        if (
          sourceInfo.kind == "video" &&
          sourceInfo.facing == (isFront ? "front" : "back")
        ) {
          videoSourceId = sourceInfo.id;
        }
      }

      getUserMedia(
        {
          audio: true,
          video: {
            mandatory: {
              minWidth: 500, // Provide your own width, height and frame rate here
              minHeight: 300,
              minFrameRate: 30
            },
            facingMode: isFront ? "user" : "environment",
            optional: videoSourceId ? [{ sourceId: videoSourceId }] : []
          }
        },
        stream => callback(stream),
        this.logError
      );
    });
  }

  join(roomID) {
    socket.emit("join", roomID, (socketIds) => {
      for (const i in socketIds) {
        const socketId = socketIds[i];
        this.createPC(socketId, true);
      }
    });
  }

  createPC(socketId, isOffer) {
    const pc = new RTCPeerConnection(configuration);
    pcPeers[socketId] = pc;

    let createDataChannel = () => {
      if (pc.textDataChannel) {
        return;
      }
      const dataChannel = pc.createDataChannel("text");

      //Just log
      dataChannel.onerror = (error) => {
        console.log("dataChannel.onerror", error);
      };

      //When receiveText
      dataChannel.onmessage = (event) => {
        console.log("dataChannel.onmessage:", event.data);
        container.receiveTextData({ user: socketId, message: event.data });
      };

      //Set connected flag
      dataChannel.onopen = () => {
        console.log("dataChannel.onopen");
        container.setState({ textRoomConnected: true });
      };

      //Just log
      dataChannel.onclose = () => {
        console.log("dataChannel.onclose");
      };

      pc.textDataChannel = dataChannel;
    }

    //Send Video Description
    let createOffer = () => {
      pc.createOffer((desc) => {
        console.log("createOffer", desc);
        pc.setLocalDescription(
          desc,
          () => {
            console.log("setLocalDescription", pc.localDescription);
            socket.emit("exchange", { to: socketId, sdp: pc.localDescription });
          },
          this.logError
        );
      }, this.logError);
    }

    //Send network information
    pc.onicecandidate = (event) => {
      console.log("onicecandidate", event.candidate);
      if (event.candidate) {
        socket.emit("exchange", { to: socketId, candidate: event.candidate });
      }
    };

    pc.onnegotiationneeded = () => {
      console.log("onnegotiationneeded");
      if (isOffer) {
        createOffer();
      }
    };

    pc.oniceconnectionstatechange = event => {
      console.log(
        "oniceconnectionstatechange",
        event.target.iceConnectionState
      );
      if (event.target.iceConnectionState === "completed") {
        setTimeout(() => {
          this.getStats();
        }, 1000);
      }
      if (event.target.iceConnectionState === "connected") {
        createDataChannel();
      }
    };

    //just log
    pc.onsignalingstatechange = (event) => {
      console.log("onsignalingstatechange", event.target.signalingState);
    };

    //set stream and add remote to list
    pc.onaddstream = (event) => {
      console.log("onaddstream", event.stream);
      container.setState({ info: "One peer join!" });

      const remoteList = container.state.remoteList;
      remoteList[socketId] = event.stream.toURL();
      container.setState({ remoteList: remoteList });
    };

    //just log
    pc.onremovestream = (event) => {
      console.log("onremovestream", event.stream);
    };

    pc.addStream(localStream);

    return pc;
  }

  exchange(data) {
    const fromId = data.from;
    let pc;
    if (fromId in pcPeers) {
      pc = pcPeers[fromId];
    } else {
      pc = this.createPC(fromId, false);
    }

    if (data.sdp) { //Exchange video informaiton
      console.log("exchange sdp", data);
      pc.setRemoteDescription(
        new RTCSessionDescription(data.sdp),
        () => {
          if (pc.remoteDescription.type == "offer")
            pc.createAnswer((desc) => {
              console.log("createAnswer", desc);
              pc.setLocalDescription(
                desc,
                () => {
                  console.log("setLocalDescription", pc.localDescription);
                  socket.emit("exchange", {
                    to: fromId,
                    sdp: pc.localDescription
                  });
                },
                this.logError
              );
            }, this.logError);
        },
        this.logError
      );
    } else { //Exchange Networking
      console.log("exchange candidate", data);
      pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  }

  leave(socketId) {
    console.log("leave", socketId);
    const pc = pcPeers[socketId];
    const viewIndex = pc.viewIndex;
    pc.close();
    delete pcPeers[socketId];

    const remoteList = container.state.remoteList;
    delete remoteList[socketId];
    container.setState({ remoteList: remoteList });
    container.setState({ info: "One peer leave!" });
  }

  mapHash(hash, func) {
    const array = [];
    for (const key in hash) {
      const obj = hash[key];
      array.push(func(obj, key));
    }
    return array;
  }

  logError(error) {
    console.log("logError", error);
  }

  getStats() {
    const pc = pcPeers[Object.keys(pcPeers)[0]];
    if (
      pc.getRemoteStreams()[0] &&
      pc.getRemoteStreams()[0].getAudioTracks()[0]
    ) {
      const track = pc.getRemoteStreams()[0].getAudioTracks()[0];
      pc.getStats(
        track,
        report =>  console.log("getStats report", report),
        this.logError
      );
    }
  }

  componentDidMount() {
    socket.on("exchange", data => {
      this.exchange(data);
    });

    socket.on("leave", socketId => {
      this.leave(socketId);
    });

    socket.on("connect", data => {
      this.getLocalStream(true, (stream) => {
        localStream = stream;

        container.setState({ selfViewSrc: stream.toURL(), status: 'ready', info: 'Please enter or create room ID' });
      });
    });
  }

  _press(event) {
    this.refs.roomID.blur();
    this.setState({ status: "connect", info: "Connecting" });
    this.join(this.state.roomID);
  }

  _switchVideoType() {
    console.log("State", this.state);
    const isFront = !this.state.isFront;
    this.setState({ isFront });
    this.getLocalStream(isFront, stream => {
      if (localStream) {
        //Remove stream from every peer
        for (const id in pcPeers) {
          const pc = pcPeers[id];
          pc && pc.removeStream(localStream);
        }
        //release old stream
        localStream.release();
      }

      //set new localStream
      localStream = stream;
      console.log("URL", stream.toURL());
      container.setState({ selfViewSrc: stream.toURL() });

      //Add Stream from every peer
      for (const id in pcPeers) {
        const pc = pcPeers[id];
        pc && pc.addStream(localStream);
      }
    });
  }


  receiveTextData(data) {
    const textRoomData = this.state.textRoomData.slice();
    textRoomData.push(data);
    this.setState({ textRoomData, textRoomValue: "" });
  }

  _textRoomPress() {
    if (!this.state.textRoomValue) {
      return;
    }
    const textRoomData = this.state.textRoomData.slice();
    textRoomData.push({ user: "Me", message: this.state.textRoomValue });
    for (const key in pcPeers) {
      const pc = pcPeers[key];
      pc.textDataChannel.send(this.state.textRoomValue);
    }
    this.setState({ textRoomData, textRoomValue: "" });
  }

  _renderTextRoom() {
    return (
      <View style={styles.listViewContainer}>
        <ListView
          enableEmptySections={true}
          dataSource={this.ds.cloneWithRows(this.state.textRoomData)}
          renderRow={rowData => (
            <Text>{`${rowData.user}: ${rowData.message}`}</Text>
          )}
        />
        <TextInput
          style={{
            width: 200,
            height: 30,
            borderColor: "gray",
            borderWidth: 1
          }}
          onChangeText={value => this.setState({ textRoomValue: value })}
          value={this.state.textRoomValue}
        />
        <TouchableHighlight onPress={() => this._textRoomPress()}>
          <Text>Send</Text>
        </TouchableHighlight>
      </View>
    );
  }

  render() {
    return (
      <View style={styles.container}>
        <Text style={styles.welcome}>
          {this.state.info}
        </Text>
        {this.state.textRoomConnected && this._renderTextRoom()}
        
        <View style={{ flexDirection: "row" }}>
          <Text>
            {this.state.isFront ? "Use front camera" : "Use back camera"}
          </Text>
          <TouchableHighlight
            style={{ borderWidth: 1, borderColor: "black" }}
            onPress={() => this._switchVideoType()}
          >
            <Text>Switch camera</Text>
          </TouchableHighlight>
        </View>

        {this.state.status == "ready"
          ? <View>
              <TextInput
                ref="roomID"
                autoCorrect={false}
                style={{
                  width: 200,
                  height: 40,
                  borderColor: "gray",
                  borderWidth: 1
                }}
                onChangeText={ (text) => this.setState({ roomID: text })}
                value={this.state.roomID}
              />
              <TouchableHighlight onPress={() => this._press()}>
                <Text>Enter room</Text>
              </TouchableHighlight>
            </View>
          : null}
        
        <RTCView streamURL={this.state.selfViewSrc} style={styles.selfView} />
        <Text>Remote</Text>
        {this.mapHash(this.state.remoteList, (remote, index) => {
          return (
            <RTCView key={index} streamURL={remote} style={styles.remoteView} />
          );
        })}
      </View>
    );
  }
}
