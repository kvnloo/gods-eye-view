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
    # A minimal rendered pixel test proves the compiled programs actually
    # drive fragment output, not just that the driver accepts the source.
    def render_fixture(draw_program):
        import array
        def setup(name, args, result=None):
            f = getattr(gl, name)
            f.argtypes = args
            if result is not None: f.restype = result
            return f
        unsigned = C.c_uint
        get_error = setup("glGetError", [], unsigned)
        gen_buffers = setup("glGenBuffers", [integer, C.POINTER(unsigned)])
        bind_buffer = setup("glBindBuffer", [unsigned, unsigned])
        buffer_data = setup("glBufferData", [unsigned, C.c_ssize_t, C.c_void_p, unsigned])
        gen_vaos = setup("glGenVertexArrays", [integer, C.POINTER(unsigned)])
        bind_vao = setup("glBindVertexArray", [unsigned])
        enable_attr = setup("glEnableVertexAttribArray", [unsigned])
        attr_pointer = setup("glVertexAttribPointer", [unsigned, integer, unsigned, C.c_ubyte, integer, ptr])
        attr_divisor = setup("glVertexAttribDivisor", [unsigned, unsigned])
        gen_textures = setup("glGenTextures", [integer, C.POINTER(unsigned)])
        bind_texture = setup("glBindTexture", [unsigned, unsigned])
        tex_image = setup("glTexImage2D", [unsigned, integer, integer, integer, integer, integer, unsigned, unsigned, ptr])
        gen_fb = setup("glGenFramebuffers", [integer, C.POINTER(unsigned)])
        bind_fb = setup("glBindFramebuffer", [unsigned, unsigned])
        fb_tex = setup("glFramebufferTexture2D", [unsigned, unsigned, unsigned, unsigned, integer])
        draw_buffers = setup("glDrawBuffers", [integer, C.POINTER(unsigned)])
        fb_status = setup("glCheckFramebufferStatus", [unsigned], unsigned)
        view_port = setup("glViewport", [integer, integer, integer, integer])
        clear_color = setup("glClearColor", [C.c_float]*4)
        clear = setup("glClear", [unsigned])
        clear_depth = setup("glClearDepth", [C.c_double])
        enable = setup("glEnable", [unsigned])
        use_program = setup("glUseProgram", [unsigned])
        location = setup("glGetUniformLocation", [unsigned, C.c_char_p], integer)
        uniform2f = setup("glUniform2f", [integer, C.c_float, C.c_float])
        uniform1f = setup("glUniform1f", [integer, C.c_float])
        draw = setup("glDrawArraysInstanced", [unsigned, integer, integer, integer])
        read = setup("glReadPixels", [integer, integer, integer, integer, unsigned, unsigned, ptr])
        rb_gen = setup("glGenRenderbuffers", [integer, C.POINTER(unsigned)])
        rb_bind = setup("glBindRenderbuffer", [unsigned, unsigned])
        rb_storage = setup("glRenderbufferStorage", [unsigned, unsigned, integer, integer])
        rb_attach = setup("glFramebufferRenderbuffer", [unsigned, unsigned, unsigned, unsigned])
        texture_filter = setup("glTexParameteri", [unsigned, unsigned, integer])
        vao = unsigned();gen_vaos(1,C.byref(vao));bind_vao(vao.value)
        buffers = (unsigned*2)();gen_buffers(2,buffers)
        vertices = (C.c_float*8)(-1,-1, 1,-1, -1,1, 1,1)
        bind_buffer(0x8892,buffers[0]);buffer_data(0x8892,C.sizeof(vertices),C.cast(vertices,ptr),0x88E4)
        enable_attr(0);attr_pointer(0,2,0x1406,0,0,None)
        instance = (C.c_float*12)(32.5,32.5,6,6, .8,.2,.1,1, .4,0,1,0)
        bind_buffer(0x8892,buffers[1]);buffer_data(0x8892,C.sizeof(instance),C.cast(instance,ptr),0x88E4)
        for slot,n,offset in ((1,4,0),(2,4,4),(3,2,8),(4,2,10)):
            enable_attr(slot);attr_pointer(slot,n,0x1406,0,12*4,ptr(offset*4));attr_divisor(slot,1)
        fb=unsigned();gen_fb(1,C.byref(fb));bind_fb(0x8D40,fb.value)
        texts=(unsigned*2)();gen_textures(2,texts)
        for i in range(2):
            bind_texture(0x0DE1,texts[i]);texture_filter(0x0DE1,0x2801,0x2600)
            texture_filter(0x0DE1,0x2800,0x2600)
            tex_image(0x0DE1,0,0x8058,64,64,0,0x1908,0x1401,None)
            fb_tex(0x8D40,0x8CE0+i,0x0DE1,texts[i],0)
        draw_buffers(2,(unsigned*2)(0x8CE0,0x8CE1))
        renderbuffer=unsigned();rb_gen(1,C.byref(renderbuffer));rb_bind(0x8D41,renderbuffer.value)
        rb_storage(0x8D41,0x81A5,64,64) # DEPTH_COMPONENT16
        rb_attach(0x8D40,0x8D00,0x8D41,renderbuffer.value)
        if fb_status(0x8D40)!=0x8CD5: raise RuntimeError("EGL test framebuffer incomplete")
        view_port(0,0,64,64);clear_color(.035,.055,.09,1);clear_depth(1)
        clear(0x00004000|0x00000100);enable(0x0B71)  # COLOR_BUFFER_BIT | DEPTH_BUFFER_BIT, DEPTH_TEST
        use_program(draw_program)
        uniform2f(location(draw_program,b"uSize"),64,64)
        uniform2f(location(draw_program,b"uCamera"),0,0)
        uniform1f(location(draw_program,b"uFrame"),0)
        draw(0x0005,0,4,1) # TRIANGLE_STRIP, 1 instance
        mid=(C.c_ubyte*4)();edge=(C.c_ubyte*4)()
        read(32,32,1,1,0x1908,0x1401,C.cast(mid,ptr))
        read(0,0,1,1,0x1908,0x1401,C.cast(edge,ptr))
        if get_error(): raise RuntimeError("OpenGL error after test splat draw")
        if mid[0]<150 or mid[1]>100 or edge[0]>30:
            raise RuntimeError(f"Unexpected stochastic splat output: center={list(mid)} background={list(edge)}")
        return {"centerRGBA":list(mid),"backgroundRGBA":list(edge)}

    linked_programs = {}
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
        linked_programs[name] = handle
        gl.glDeleteShader(v)
        gl.glDeleteShader(f)
    info["renderedFixture"] = render_fixture(linked_programs["stochastic"])
    for handle in linked_programs.values(): gl.glDeleteProgram(handle)
    info["compiledAndLinkedPrograms"] = [name for name, _, _ in pairs]
    info["scope"] = "native EGL software/hardware shader compiler and 1-splat raster fixture; not WebGL2 API or speed"
    return info


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--require-hardware", action="store_true")
    args = parser.parse_args()
    print(json.dumps(native_compile(require_hardware=args.require_hardware), indent=2))
