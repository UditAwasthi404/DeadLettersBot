//! RFB/VNC frame helpers — incremental port of `packages/desktop/src/rfb.ts`.
//!
//! # Public surface checklist (port from TS)
//! - [x] `PixelFormat` (bpp/depth/endian/true-colour)
//! - [x] `Rect` damage region
//! - [x] `decode_raw` — opaque alpha RGBA fill
//! - [x] `copy_rect` — framebuffer blit
//! - [ ] handshake / security types
//! - [ ] Tight / ZRLE decoders
//! - [ ] damage-based update loop + events
//! - [ ] zero-copy `BytesMut` streaming path

use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PixelFormat {
    pub bits_per_pixel: u8,
    pub depth: u8,
    pub big_endian: bool,
    pub true_colour: bool,
}

impl PixelFormat {
    pub const RGBA8888_LE: Self = Self {
        bits_per_pixel: 32,
        depth: 24,
        big_endian: false,
        true_colour: true,
    };
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: u16,
    pub y: u16,
    pub width: u16,
    pub height: u16,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RfbError {
    #[error("unsupported pixel format")]
    UnsupportedFormat,
    #[error("rectangle out of bounds")]
    OutOfBounds,
    #[error("pixel buffer too short")]
    Truncated,
}

/// Decode a Raw encoding rectangle into an RGBA8888 framebuffer (`stride = width * 4`).
pub fn decode_raw(
    framebuffer: &mut [u8],
    fb_width: u16,
    fb_height: u16,
    rect: Rect,
    pixels: &[u8],
    format: PixelFormat,
) -> Result<(), RfbError> {
    if format.bits_per_pixel != 32 || !format.true_colour {
        return Err(RfbError::UnsupportedFormat);
    }
    let right = u32::from(rect.x) + u32::from(rect.width);
    let bottom = u32::from(rect.y) + u32::from(rect.height);
    if right > u32::from(fb_width) || bottom > u32::from(fb_height) {
        return Err(RfbError::OutOfBounds);
    }
    let expected = usize::from(rect.width) * usize::from(rect.height) * 4;
    if pixels.len() < expected {
        return Err(RfbError::Truncated);
    }
    let stride = usize::from(fb_width) * 4;
    let mut src = 0usize;
    for row in 0..usize::from(rect.height) {
        let dst_row = (usize::from(rect.y) + row) * stride + usize::from(rect.x) * 4;
        for col in 0..usize::from(rect.width) {
            let b = pixels[src];
            let g = pixels[src + 1];
            let r = pixels[src + 2];
            // RFB little-endian 32bpp is typically BGRA in the wire buffer; store RGBA.
            let px = dst_row + (col * 4);
            framebuffer[px] = r;
            framebuffer[px + 1] = g;
            framebuffer[px + 2] = b;
            framebuffer[px + 3] = 255;
            src += 4;
        }
    }
    Ok(())
}

/// CopyRect: copy pixels within the framebuffer.
pub fn copy_rect(
    framebuffer: &mut [u8],
    fb_width: u16,
    fb_height: u16,
    dest: Rect,
    src_x: u16,
    src_y: u16,
) -> Result<(), RfbError> {
    let right = u32::from(dest.x) + u32::from(dest.width);
    let bottom = u32::from(dest.y) + u32::from(dest.height);
    let src_right = u32::from(src_x) + u32::from(dest.width);
    let src_bottom = u32::from(src_y) + u32::from(dest.height);
    if right > u32::from(fb_width)
        || bottom > u32::from(fb_height)
        || src_right > u32::from(fb_width)
        || src_bottom > u32::from(fb_height)
    {
        return Err(RfbError::OutOfBounds);
    }
    let stride = usize::from(fb_width) * 4;
    let mut rows = Vec::with_capacity(usize::from(dest.height));
    for row in 0..usize::from(dest.height) {
        let src_off = (usize::from(src_y) + row) * stride + usize::from(src_x) * 4;
        let len = usize::from(dest.width) * 4;
        rows.push(framebuffer[src_off..src_off + len].to_vec());
    }
    for (row, data) in rows.into_iter().enumerate() {
        let dst_off = (usize::from(dest.y) + row) * stride + usize::from(dest.x) * 4;
        framebuffer[dst_off..dst_off + data.len()].copy_from_slice(&data);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decode_raw_sets_opaque_alpha() {
        let mut fb = vec![0u8; 4 * 4]; // 2x2
        let pixels = [
            10u8, 20, 30, 0, // BGRA
            1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0,
        ];
        decode_raw(
            &mut fb,
            2,
            2,
            Rect {
                x: 0,
                y: 0,
                width: 2,
                height: 2,
            },
            &pixels,
            PixelFormat::RGBA8888_LE,
        )
        .unwrap();
        assert_eq!(&fb[0..4], &[30, 20, 10, 255]);
    }

    #[test]
    fn copy_rect_moves_block() {
        let mut fb = vec![0u8; 8 * 2]; // 2x2
        fb[0..4].copy_from_slice(&[1, 2, 3, 255]);
        copy_rect(
            &mut fb,
            2,
            2,
            Rect {
                x: 1,
                y: 0,
                width: 1,
                height: 1,
            },
            0,
            0,
        )
        .unwrap();
        assert_eq!(&fb[4..8], &[1, 2, 3, 255]);
    }
}
