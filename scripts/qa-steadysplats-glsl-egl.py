#!/usr/bin/env python3
"""Check every experimental GLSL shader pair via EGL/OpenGL, without a browser.

This is an optional _driver shader-compiler_ diagnostic. It does not establish
WebGL2 API compatibility or prove performance on a physical GPU. It requires an
OpenGL driver with ARB_ES3_compatibility; `--require-hardware` also rejects
Mesa llvmpipe/SwiftShader and other software renderers.
"""
import argparse
import ctypes as C
import json
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
SOURCE = HERE / "src/experiments/steadysplats/gpuRenderer.js"


def extract_shaders(source):
    templates = dict(re.findall(r"const ([A-Z_]+) = `(.*?)`;", source, re.S))
    common = templates["SAMPLE_COMMON"]
    return {key: text.replace("${SAMPLE_COMMON}", common)
            for key, text in templates.items() if key != "SAMPLE_COMMON"}


def native_compile(require_hardware=False):
    egl = C.CDLL("libEGL.so.1")
    gl = C.CDLL("libGL.so.1")
    ptr = C.c_void_p
    integer = C.c_int
    egl.eglGetProcAddress.argtypes = [C.c_char_p]
    egl.eglGetProcAddress.restype = ptr
    addr = egl.eglGetProcAddress(b"eglGetPlatformDisplayEXT")
    if addr:
        platform_display = C.CFUNCTYPE(ptr, C.c_uint, ptr, C.POINTER(integer))(addr)
        display = platform_display(0x31DD, None, None)  # EGL_PLATFORM_SURFACELESS_MESA
    else:
        egl.eglGetDisplay.restype = ptr
        display = egl.eglGetDisplay(None)
    egl.eglInitialize.argtypes = [ptr, C.POINTER(integer), C.POINTER(integer)]
    egl.eglInitialize.restype = C.c_uint
    major, minor = integer(), integer()
    if not display or not egl.eglInitialize(display, C.byref(major), C.byref(minor)):
        raise RuntimeError("Unable to initialize EGL (headless driver unavailable)")
    egl.eglBindAPI.argtypes = [C.c_uint]
    egl.eglBindAPI.restype = C.c_uint
    if not egl.eglBindAPI(0x30A2):  # EGL_OPENGL_API
        raise RuntimeError("Driver cannot bind desktop OpenGL API")
    egl.eglCreateContext.argtypes = [ptr, ptr, ptr, C.POINTER(integer)]
    egl.eglCreateContext.restype = ptr
    context = egl.eglCreateContext(display, None, None, (integer * 3)(0x3098, 3, 0x3038))
    egl.eglMakeCurrent.argtypes = [ptr, ptr, ptr, ptr]
    egl.eglMakeCurrent.restype = C.c_uint
    if not context or not egl.eglMakeCurrent(display, None, None, context):
        raise RuntimeError("Unable to create surfaceless desktop OpenGL context")
    gl.glGetString.argtypes = [C.c_uint]
    gl.glGetString.restype = C.c_char_p
    info = {label: gl.glGetString(enum).decode(errors="replace") for label, enum in
            (("renderer", 0x1F01), ("vendor", 0x1F00), ("version", 0x1F02))}
    info["software"] = bool(re.search(r"swiftshader|llvmpipe|softpipe|software|lavapipe|basic render|warp device", info["renderer"], re.I))
    if require_hardware and info["software"]:
        raise RuntimeError("Hardware required: EGL reports software renderer: " + info["renderer"])

    gl.glCreateShader.argtypes = [C.c_uint]
    gl.glCreateShader.restype = C.c_uint
    gl.glShaderSource.argtypes = [C.c_uint, integer, C.POINTER(C.c_char_p), C.POINTER(integer)]
    gl.glCompileShader.argtypes = [C.c_uint]
    gl.glGetShaderiv.argtypes = [C.c_uint, C.c_uint, C.POINTER(integer)]
    gl.glGetShaderInfoLog.argtypes = [C.c_uint, integer, C.POINTER(integer), C.c_char_p]
    gl.glCreateProgram.restype = C.c_uint
    gl.glAttachShader.argtypes = [C.c_uint, C.c_uint]
    gl.glLinkProgram.argtypes = [C.c_uint]
    gl.glGetProgramiv.argtypes = [C.c_uint, C.c_uint, C.POINTER(integer)]
    gl.glGetProgramInfoLog.argtypes = [C.c_uint, integer, C.POINTER(integer), C.c_char_p]
    gl.glDeleteShader.argtypes = [C.c_uint]
    gl.glDeleteProgram.argtypes = [C.c_uint]

    def compiler(kind, text):
        handle = gl.glCreateShader(0x8B31 if kind == "VERTEX" else 0x8B30)
        raw = text.encode()
        payload = C.c_char_p(raw)
        length = integer(len(raw))
        gl.glShaderSource(handle, 1, C.byref(payload), C.byref(length))
        gl.glCompileShader(handle)
        passed = integer()
        gl.glGetShaderiv(handle, 0x8B81, C.byref(passed))
        if not passed.value:
            log = C.create_string_buffer(8192)
            gl.glGetShaderInfoLog(handle, 8192, None, log)
            raise RuntimeError(kind + " GLSL compile failed: " + log.value.decode(errors="replace"))
        return handle

    source = extract_shaders(SOURCE.read_text())
    pairs = [
        ("reference", "VERTEX_GAUSSIAN", "FRAGMENT_REFERENCE"),
        ("stochastic", "VERTEX_GAUSSIAN", "FRAGMENT_STOCHASTIC"),
        ("spatial", "VERTEX_SCREEN", "FRAGMENT_SPATIAL"),
        ("temporal", "VERTEX_SCREEN", "FRAGMENT_TEMPORAL"),
        ("display", "VERTEX_SCREEN", "FRAGMENT_DISPLAY"),
    ]
    for name, vert, frag in pairs:
        v = compiler("VERTEX", source[vert])
        f = compiler("FRAGMENT", source[frag])
        handle = gl.glCreateProgram()
        gl.glAttachShader(handle, v)
        gl.glAttachShader(handle, f)
        gl.glLinkProgram(handle)
        passed = integer()
        gl.glGetProgramiv(handle, 0x8B82, C.byref(passed))
        if not passed.value:
            log = C.create_string_buffer(8192)
            gl.glGetProgramInfoLog(handle, 8192, None, log)
            raise RuntimeError(name + " GLSL link failed: " + log.value.decode(errors="replace"))
        gl.glDeleteProgram(handle)
        gl.glDeleteShader(v)
        gl.glDeleteShader(f)
    info["compiledAndLinkedPrograms"] = [name for name, _, _ in pairs]
    info["scope"] = "native EGL shader compiler; not WebGL2 runtime, graphics output, or speed"
    return info


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-hardware", action="store_true")
    args = parser.parse_args()
    print(json.dumps(native_compile(require_hardware=args.require_hardware), indent=2))
