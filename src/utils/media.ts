import type { Message } from "grammy/types";
import type { MediaInput } from "../models/course.js";

export function mediaFromMessage(message: Message): MediaInput | undefined {
  if (message.photo) {
    const photo = [...message.photo].sort(
      (a, b) => b.width * b.height - a.width * a.height,
    )[0];
    if (!photo) return undefined;
    return {
      type: "photo",
      fileId: photo.file_id,
      uniqueId: photo.file_unique_id,
      size: photo.file_size,
      width: photo.width,
      height: photo.height,
    };
  }
  if (message.video) {
    const video = message.video;
    return {
      type: "video",
      fileId: video.file_id,
      uniqueId: video.file_unique_id,
      size: video.file_size,
      width: video.width,
      height: video.height,
      duration: video.duration,
    };
  }
  return undefined;
}
